export async function readSseMessages(response: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await response.text();
  return raw.split(/\r?\n\r?\n/).flatMap((event) =>
    event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>)
  );
}
