// Bosta carrier client — Admin REST API.
// Env: BOSTA_API_BASE (default https://app.bosta.co/api/v2), BOSTA_API_KEY,
//      BOSTA_BUSINESS_LOCATION_ID
const logger = require('../../../lib/logger');

const BASE = process.env.BOSTA_API_BASE || 'https://app.bosta.co/api/v2';

function isConfigured() {
  return Boolean(process.env.BOSTA_API_KEY);
}

async function request(method, path, body, { responseType = 'json' } = {}) {
  if (!isConfigured()) {
    const err = new Error('bosta not configured');
    err.code = 'BOSTA_NOT_CONFIGURED';
    throw err;
  }
  const url = `${BASE.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: process.env.BOSTA_API_KEY,
      'Content-Type': 'application/json',
      Accept: responseType === 'buffer' ? 'application/pdf, application/octet-stream' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn({ method, path, status: res.status, body: text.slice(0, 500) }, 'bosta API non-2xx');
    const err = new Error(`bosta ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  if (responseType === 'buffer') {
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  return res.json();
}

// Map our Shipment to Bosta delivery payload.
function buildDeliveryPayload(shipment) {
  const so = shipment.salesOrder;
  const cust = so?.customer;
  const cod = 0;
  return {
    type: 10, // SEND (delivery)
    specs: {
      packageType: 'Parcel',
      packageDetails: { itemsCount: shipment.lines?.length || 1, description: `Order ${so?.orderNumber || shipment.shipmentNumber}` },
    },
    notes: shipment.notes || '',
    cod,
    dropOffAddress: {
      city: { name: 'Cairo' },
      firstLine: cust?.shippingAddress || so?.customerName || 'N/A',
    },
    receiver: {
      firstName: (cust?.name || so?.customerName || 'Customer').split(' ')[0] || 'Customer',
      lastName: ((cust?.name || so?.customerName || 'Customer').split(' ').slice(1).join(' ')) || '-',
      phone: cust?.phone || '+201000000000',
      email: cust?.email || so?.customerEmail || undefined,
    },
    businessReference: shipment.shipmentNumber,
  };
}

async function createDelivery(payload) {
  return request('POST', '/deliveries', payload);
}

async function fetchLabelPdf(deliveryId) {
  return request('GET', `/deliveries/${deliveryId}/awb`, null, { responseType: 'buffer' });
}

// Map Bosta tracking states → our ShipmentStatus enum.
// Bosta state codes documented at https://docs.bosta.co
const STATE_MAP = {
  // Pickup-related
  10: 'PENDING',
  11: 'PENDING',
  20: 'IN_TRANSIT',
  21: 'IN_TRANSIT',
  22: 'IN_TRANSIT',
  23: 'IN_TRANSIT',
  24: 'IN_TRANSIT',
  41: 'OUT_FOR_DELIVERY',
  42: 'OUT_FOR_DELIVERY',
  45: 'DELIVERED',
  46: 'DELIVERED',
  47: 'FAILED',
  48: 'FAILED',
  100: 'RETURNED',
};

function mapState(code) {
  return STATE_MAP[Number(code)] || null;
}

module.exports = { isConfigured, createDelivery, fetchLabelPdf, mapState, buildDeliveryPayload };
