import { inflateRawSync } from 'node:zlib';
import { NHC_KMZ_MAX_ENTRIES, NHC_KMZ_MAX_EXPANDED_BYTES } from '@gev/contracts';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_EOCD_SEARCH_BYTES = 65_557;

export interface KmzLimits {
  maxEntries?: number;
  maxExpandedBytes?: number;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const firstOffset = Math.max(0, bytes.length - MAX_EOCD_SEARCH_BYTES);
  for (let offset = bytes.length - 22; offset >= firstOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('KMZ central directory is missing');
}

function decodeEntryName(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function assertSafeEntryName(name: string): void {
  const normalized = name.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    name.includes('\\') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('KMZ entry path is unsafe');
  }
  if (/\.(?:zip|kmz)$/i.test(normalized)) {
    throw new Error('Nested archives are not permitted in NHC advisory assets');
  }
}

/** Extracts one bounded KML document without writing archive content to disk. */
export function extractBoundedKmlFromKmz(input: Uint8Array, limits: KmzLimits = {}): string {
  const maxEntries = limits.maxEntries ?? NHC_KMZ_MAX_ENTRIES;
  const maxExpandedBytes = limits.maxExpandedBytes ?? NHC_KMZ_MAX_EXPANDED_BYTES;
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Multi-disk KMZ archives are not supported');
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff) {
    throw new Error('ZIP64 KMZ archives are not supported');
  }
  if (entryCount < 1 || entryCount > maxEntries) {
    throw new Error(`KMZ entry count exceeds ${maxEntries}`);
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new Error('KMZ central directory bounds are invalid');
  }

  let offset = centralDirectoryOffset;
  let expandedBytes = 0;
  let selectedKml: Buffer | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('KMZ central directory entry is invalid');
    }
    const generalPurposeFlags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > centralDirectoryOffset + centralDirectorySize) {
      throw new Error('KMZ entry metadata exceeds central directory bounds');
    }
    if ((generalPurposeFlags & 0x0001) !== 0) {
      throw new Error('Encrypted KMZ entries are not supported');
    }

    const name = decodeEntryName(bytes.subarray(offset + 46, offset + 46 + fileNameLength));
    assertSafeEntryName(name);
    expandedBytes += uncompressedSize;
    if (expandedBytes > maxExpandedBytes) {
      throw new Error(`KMZ expanded content exceeds ${maxExpandedBytes} bytes`);
    }

    if (
      localHeaderOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new Error('KMZ local file header is invalid');
    }
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = bytes.readUInt16LE(localHeaderOffset + 8);
    const localNameOffset = localHeaderOffset + 30;
    const localNameEnd = localNameOffset + localNameLength;
    if (localNameEnd > bytes.length) throw new Error('KMZ local entry name exceeds archive bounds');
    const localName = decodeEntryName(bytes.subarray(localNameOffset, localNameEnd));
    if (
      localName !== name ||
      localFlags !== generalPurposeFlags ||
      localCompressionMethod !== compressionMethod
    ) {
      throw new Error('KMZ central and local entry metadata do not match');
    }
    const contentOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const contentEnd = contentOffset + compressedSize;
    if (contentEnd > centralDirectoryOffset) {
      throw new Error('KMZ entry content exceeds local-content bounds');
    }

    if (/\.kml$/i.test(name) && selectedKml === null) {
      const compressed = bytes.subarray(contentOffset, contentEnd);
      if (compressionMethod === 0) {
        selectedKml = Buffer.from(compressed);
      } else if (compressionMethod === 8) {
        selectedKml = inflateRawSync(compressed, { maxOutputLength: maxExpandedBytes });
      } else {
        throw new Error(`Unsupported KMZ compression method ${compressionMethod}`);
      }
      if (
        selectedKml.byteLength !== uncompressedSize ||
        selectedKml.byteLength > maxExpandedBytes
      ) {
        throw new Error('KMZ entry expanded size does not match its bounded metadata');
      }
    }

    offset = entryEnd;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error('KMZ central directory size does not match its entries');
  }

  if (selectedKml === null) throw new Error('KMZ does not contain a KML document');
  return new TextDecoder('utf-8', { fatal: true }).decode(selectedKml);
}
