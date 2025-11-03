export async function check({ date, durationMinutes = 30 }) {
  return { available: true, date: date || new Date().toISOString(), durationMinutes };
}
