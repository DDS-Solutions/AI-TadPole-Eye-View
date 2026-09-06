import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractBoundedKmlFromKmz } from '../src/boundedKmz.js';

function storedZip(
  name: string,
  content: string,
  declaredSize = Buffer.byteLength(content)
): Buffer {
  const nameBytes = Buffer.from(name);
  const contentBytes = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(contentBytes.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(contentBytes.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBytes.length, 28);

  const centralOffset = local.length + nameBytes.length + contentBytes.length;
  const centralSize = central.length + nameBytes.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, contentBytes, central, nameBytes, end]);
}

describe('bounded KMZ extraction', () => {
  it('extracts one in-memory KML entry and enforces expanded-byte metadata', () => {
    const kml = '<kml><Placemark/></kml>';
    expect(extractBoundedKmlFromKmz(storedZip('doc.kml', kml))).toBe(kml);
    expect(() =>
      extractBoundedKmlFromKmz(storedZip('doc.kml', kml, 1_001), { maxExpandedBytes: 1_000 })
    ).toThrow('expanded content exceeds');
  });

  it('rejects traversal, absolute, ambiguous, and nested archive entry names', () => {
    const token = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 1, maxLength: 12 })
      .map((characters) => characters.join(''));
    const unsafeName = token.chain((value) =>
      fc.constantFrom(
        `../${value}.kml`,
        `/${value}.kml`,
        `C:/${value}.kml`,
        `nested\\${value}.kml`,
        `${value}//doc.kml`,
        `${value}.kmz`
      )
    );
    fc.assert(
      fc.property(unsafeName, (name) => {
        expect(() => extractBoundedKmlFromKmz(storedZip(name, '<kml/>'))).toThrow();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects encrypted entries and ambiguous local-header metadata', () => {
    const encrypted = storedZip('doc.kml', '<kml/>');
    const encryptedCentralOffset = encrypted.readUInt32LE(encrypted.length - 6);
    encrypted.writeUInt16LE(1, 6);
    encrypted.writeUInt16LE(1, encryptedCentralOffset + 8);
    expect(() => extractBoundedKmlFromKmz(encrypted)).toThrow('Encrypted KMZ entries');

    const mismatchedName = storedZip('doc.kml', '<kml/>');
    mismatchedName.write('x', 30, 'utf8');
    expect(() => extractBoundedKmlFromKmz(mismatchedName)).toThrow(
      'central and local entry metadata do not match'
    );

    const mismatchedCompression = storedZip('doc.kml', '<kml/>');
    mismatchedCompression.writeUInt16LE(8, 8);
    expect(() => extractBoundedKmlFromKmz(mismatchedCompression)).toThrow(
      'central and local entry metadata do not match'
    );
  });
});
