let docs = new Map();
export async function write({ docId, content }) {
  const id = docId || `doc_${Date.now()}`;
  docs.set(id, String(content || ''));
  return { docId: id, bytes: Buffer.from(String(content||'')).length };
}
export async function read({ docId }) {
  if (!docId) throw new Error('docId requerido');
  return { docId, content: docs.get(docId) || '' };
}
