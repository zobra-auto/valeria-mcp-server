export async function create({ when, who, notes }) {
  if (!when || !who) throw new Error('Parámetros requeridos: when, who');
  return { id: `evt_${Date.now()}`, when, who, notes: notes || null };
}
export async function cancel({ id }) {
  if (!id) throw new Error('Parámetro requerido: id');
  return { id, cancelled: true };
}
export async function check({ from, to }) {
  return { slots: [{ start: from || new Date().toISOString(), end: to || new Date(Date.now()+3600000).toISOString() }] };
}
