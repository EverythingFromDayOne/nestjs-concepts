export async function loadSchemaFrom(_url: string): Promise<{ ok: true }> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { ok: true };
}
