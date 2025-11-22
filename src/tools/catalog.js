// src/tools/catalog.js
import fs from 'fs';
import path from 'path';
import { createRequestLogger, logWithDuration } from '../utils/logger.js';

const BARBERS_JSON_PATH =
  process.env.BARBERS_JSON || path.join(process.cwd(), 'data', 'barbers.json');

// Cache en memoria de barberos
let barbersCache = null;

function loadBarbersForCatalog() {
  if (barbersCache) return barbersCache;

  const log = createRequestLogger({ tool: 'catalog', action: 'loadBarbers' });

  try {
    if (!fs.existsSync(BARBERS_JSON_PATH)) {
      log.warn({ path: BARBERS_JSON_PATH }, 'BARBERS_JSON_NOT_FOUND_FOR_CATALOG');
      barbersCache = {};
      return barbersCache;
    }

    const raw = fs.readFileSync(BARBERS_JSON_PATH, 'utf8').trim();
    if (!raw) {
      log.warn({ path: BARBERS_JSON_PATH }, 'BARBERS_JSON_EMPTY_FOR_CATALOG');
      barbersCache = {};
      return barbersCache;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      log.error({ path: BARBERS_JSON_PATH }, 'BARBERS_JSON_INVALID_FOR_CATALOG');
      barbersCache = {};
      return barbersCache;
    }

    barbersCache = parsed;
  } catch (err) {
    log.error(
      {
        err: { message: err.message, stack: err.stack },
        path: BARBERS_JSON_PATH,
      },
      'BARBERS_JSON_LOAD_ERROR_FOR_CATALOG'
    );
    barbersCache = {};
  }

  return barbersCache;
}

function normalize(str = '') {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Datos base de la ÚNICA barbería, tomados del Word.
 * Aquí no metemos barberos todavía; se agregan dinámicamente.
 */
const BASE_SHOP = {
  id: 'shop-001',
  nombre: 'Estilo Supremo Barbería',
  ciudad: 'Colonia Centro',
  descripcion_corta:
    'Barbería donde se fusiona la tradición clásica con el estilo moderno, enfocada en ofrecer una experiencia de alta calidad.',
  descripcion_larga: [
    'Bienvenido a Estilo Supremo Barbería, donde fusionamos tradición y estilo moderno para ofrecerte una experiencia de cuidado personal única. Desde nuestros inicios, nos hemos enfocado en brindar atención detallada, asesoría personalizada y resultados impecables, convirtiéndonos en un referente de estilo y excelencia en la comunidad.',
    'Nuestro ambiente combina el estilo clásico de las barberías tradicionales con toques contemporáneos, creando un espacio cómodo y moderno donde te sentirás como en casa. Aquí no solo vienes a cortarte el cabello o a arreglarte la barba; vienes a disfrutar de un momento para ti, en manos de barberos profesionales que se apasionan por lo que hacen.',
  ],
  horario: {
    lunes_a_viernes: { abre: '09:00', cierra: '20:00' },
    sabado: { abre: '10:00', cierra: '18:00' },
    domingo: { cerrado: true },
  },
  politica_citas:
    'Aceptamos clientes sin cita previa, pero recomendamos agendar con anticipación para garantizar disponibilidad.',
  medios_pago: [
    'Efectivo',
    'Tarjetas de débito/crédito',
    'Pagos móviles',
  ],
  ubicacion: {
    direccion: 'Av. Principal #123, Colonia Centro',
    telefono: '(555) 123-4567',
    email: 'contacto@estilosupremo.com',
    descripcion:
      'Ubicación céntrica de fácil acceso, cerca de la estación de metro "Centro" y a pocas cuadras del centro comercial principal.',
  },
  servicios: [
    {
      id: 'svc-corte-clasico',
      nombre: 'Corte de Cabello Clásico',
      duracion_min: 30,
      precio: 25,
      descripcion:
        'Corte tradicional adaptado a tu estilo personal, incluye lavado y peinado final.',
    },
    {
      id: 'svc-barba-completa',
      nombre: 'Arreglo de Barba Completo',
      duracion_min: 25,
      precio: 20,
      descripcion:
        'Recorte, definición de líneas, afeitado con navaja tradicional y tratamiento hidratante.',
    },
    {
      id: 'svc-premium',
      nombre: 'Paquete Premium (Corte + Barba)',
      duracion_min: 50,
      precio: 40,
      descripcion:
        'Experiencia completa que incluye corte de cabello, arreglo de barba, masaje facial y toalla caliente.',
    },
  ],
};

/**
 * Construye la barbería con la lista de barberos reales del barbers.json
 */
function buildFullShop() {
  const barbersCfg = loadBarbersForCatalog();
  const barberos = [];

  let idx = 1;
  for (const [barberId, cfg] of Object.entries(barbersCfg)) {
    barberos.push({
      id: idx, // numérico simple
      barber_id: barberId, // nova, atlas, shadow, etc.
      nombre: cfg.displayName,
      aliases: cfg.aliases || [],
    });
    idx++;
  }

  return {
    ...BASE_SHOP,
    barberos,
  };
}

// -------------------- ACTIONS --------------------

async function catalogSearch(params = {}) {
  const log = createRequestLogger({ tool: 'catalog', action: 'search' });
  const started = Date.now();

  const query = normalize(params.query || '');
  const shop = buildFullShop();

  const nombresServicios = shop.servicios.map((s) => s.nombre);
  const nombresBarberos = shop.barberos.map((b) => b.nombre);

  let match = true;
  if (query) {
    const nombre = normalize(shop.nombre);
    const ciudad = normalize(shop.ciudad);
    const serviciosStr = normalize(nombresServicios.join(' '));
    const barberosStr = normalize(nombresBarberos.join(' '));

    match =
      nombre.includes(query) ||
      ciudad.includes(query) ||
      serviciosStr.includes(query) ||
      barberosStr.includes(query);
  }

  const results = match
    ? [
        {
          id: shop.id,
          nombre: shop.nombre,
          servicios: nombresServicios,
          ciudad: shop.ciudad,
        },
      ]
    : [];

  logWithDuration(
    log,
    'catalog.search → completado',
    { query, results: results.length },
    started
  );

  return { results };
}

async function catalogGet(params = {}) {
  const log = createRequestLogger({ tool: 'catalog', action: 'get' });
  const started = Date.now();

  const id = String(params.id || '').trim();
  if (!id) {
    const err = new Error('CATALOG_ID_REQUIRED');
    err.code = 'CATALOG_ID_REQUIRED';
    log.error(
      { err: { message: err.message, code: err.code } },
      'catalog.get → id faltante'
    );
    throw err;
  }

  const shop = buildFullShop();

  if (id !== shop.id) {
    const err = new Error(`CATALOG_NOT_FOUND: ${id}`);
    err.code = 'CATALOG_NOT_FOUND';
    log.error(
      { err: { message: err.message, code: err.code }, id },
      'catalog.get → no encontrado'
    );
    throw err;
  }

  logWithDuration(log, 'catalog.get → completado', { id }, started);
  return { item: shop };
}

// -------------------- EXPORTS MCP --------------------

export const name = 'catalog';

export const actions = {
  async search({ params }) {
    const data = await catalogSearch(params);
    return { ok: true, data };
  },
  async get({ params }) {
    const data = await catalogGet(params);
    return { ok: true, data };
  },
};
