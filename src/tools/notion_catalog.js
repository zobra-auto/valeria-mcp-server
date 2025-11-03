const catalog = [
  { id: 'barb-001', nombre: 'Barbería Centro', servicios: ['corte', 'barba'], ciudad: 'Medellín' },
  { id: 'barb-002', nombre: 'Barber Bros', servicios: ['corte'], ciudad: 'Bogotá' }
];
export async function search({ query }) {
  if (!query) return { results: catalog };
  const q = String(query).toLowerCase();
  const results = catalog.filter(x =>
    x.nombre.toLowerCase().includes(q) ||
    x.servicios.join(' ').toLowerCase().includes(q) ||
    x.ciudad.toLowerCase().includes(q)
  );
  return { results };
}
export async function get({ id }) {
  const item = catalog.find(x => x.id === id);
  if (!item) throw new Error('No encontrado');
  return { item };
}
