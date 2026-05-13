/**
 * Customer service — Section 6 (Fulfillment).
 * Manages customers and their contacts. All write paths emit audit events.
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const PAYMENT_TERMS = ['NET_15', 'NET_30', 'NET_60', 'NET_90', 'COD', 'PREPAID'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function reqString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    bad(`${field} is required`, 400);
  }
  return value.trim();
}

function validEmail(v) {
  if (v == null || v === '') return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const CUSTOMER_INCLUDE = {
  contacts: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { salesOrders: true } },
};

// ─── Customers ──────────────────────────────────────────────────────────────

async function listCustomers(params = {}) {
  const { search, isActive, limit = 100, offset = 0 } = params;
  const where = { deletedAt: null };
  if (typeof isActive === 'boolean') where.isActive = isActive;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: CUSTOMER_INCLUDE,
      orderBy: { name: 'asc' },
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);
  return { total, items };
}

async function getCustomerById(id) {
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...CUSTOMER_INCLUDE,
      salesOrders: {
        orderBy: { orderedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          currency: true,
          orderedAt: true,
        },
      },
    },
  });
  if (!customer) bad('Customer not found', 404);
  return customer;
}

async function createCustomer(data, actor, sourceIp) {
  const code = reqString(data.code, 'code');
  const name = reqString(data.name, 'name');
  if (!validEmail(data.email)) bad('Invalid email', 400);
  if (data.paymentTerms && !PAYMENT_TERMS.includes(data.paymentTerms)) {
    bad(`paymentTerms must be one of: ${PAYMENT_TERMS.join(', ')}`, 400);
  }

  const existing = await prisma.customer.findUnique({ where: { code } });
  if (existing) bad('Customer code already exists', 409, 'DUPLICATE_CUSTOMER');

  const customer = await prisma.customer.create({
    data: {
      code,
      name,
      email: data.email || null,
      phone: data.phone || null,
      billingAddress: data.billingAddress || null,
      shippingAddress: data.shippingAddress || null,
      taxId: data.taxId || null,
      currency: data.currency || 'USD',
      paymentTerms: data.paymentTerms || 'NET_30',
      creditLimit: data.creditLimit != null ? data.creditLimit : null,
      notes: data.notes || null,
      createdById: actor?.id || null,
    },
    include: CUSTOMER_INCLUDE,
  });

  await logEvent({
    eventType: 'CUSTOMER_CREATED',
    entityType: 'Customer',
    entityId: customer.id,
    actorId: actor?.id,
    payload: { code, name },
    sourceIp,
  });
  return customer;
}

async function updateCustomer(id, data, actor, sourceIp) {
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) bad('Customer not found', 404);
  if (data.email && !validEmail(data.email)) bad('Invalid email', 400);
  if (data.paymentTerms && !PAYMENT_TERMS.includes(data.paymentTerms)) {
    bad(`paymentTerms must be one of: ${PAYMENT_TERMS.join(', ')}`, 400);
  }

  const patch = {};
  for (const f of ['name', 'email', 'phone', 'billingAddress', 'shippingAddress', 'taxId', 'currency', 'paymentTerms', 'creditLimit', 'notes', 'isActive']) {
    if (data[f] !== undefined) patch[f] = data[f];
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: patch,
    include: CUSTOMER_INCLUDE,
  });
  await logEvent({
    eventType: 'CUSTOMER_UPDATED',
    entityType: 'Customer',
    entityId: id,
    actorId: actor?.id,
    payload: { fields: Object.keys(patch) },
    sourceIp,
  });
  return customer;
}

async function deactivateCustomer(id, actor, sourceIp) {
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) bad('Customer not found', 404);
  const customer = await prisma.customer.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await logEvent({
    eventType: 'CUSTOMER_DELETED',
    entityType: 'Customer',
    entityId: id,
    actorId: actor?.id,
    payload: { code: existing.code },
    sourceIp,
  });
  return customer;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

async function addContact(customerId, data, actor, sourceIp) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!customer) bad('Customer not found', 404);
  const name = reqString(data.name, 'name');
  if (!validEmail(data.email)) bad('Invalid email', 400);

  const contact = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.customerContact.updateMany({
        where: { customerId, isPrimary: true },
        data: { isPrimary: false },
      });
    } else {
      // Ensure at least one primary contact: if none yet, make this one primary
      const existingPrimary = await tx.customerContact.count({ where: { customerId, isPrimary: true, isActive: true } });
      if (existingPrimary === 0) data.isPrimary = true;
    }
    return tx.customerContact.create({
      data: {
        customerId,
        name,
        email: data.email || null,
        phone: data.phone || null,
        role: data.role || null,
        isPrimary: !!data.isPrimary,
      },
    });
  });
  await logEvent({
    eventType: 'CUSTOMER_CONTACT_ADDED',
    entityType: 'Customer',
    entityId: customerId,
    actorId: actor?.id,
    payload: { contactId: contact.id, name },
    sourceIp,
  });
  return contact;
}

async function updateContact(customerId, contactId, data, actor, sourceIp) {
  const contact = await prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
  if (!contact) bad('Contact not found', 404);
  const patch = {};
  for (const f of ['name', 'email', 'phone', 'role', 'isActive']) {
    if (data[f] !== undefined) patch[f] = data[f];
  }
  if (data.email && !validEmail(data.email)) bad('Invalid email', 400);
  const updated = await prisma.customerContact.update({ where: { id: contactId }, data: patch });
  await logEvent({
    eventType: 'CUSTOMER_CONTACT_UPDATED',
    entityType: 'Customer',
    entityId: customerId,
    actorId: actor?.id,
    payload: { contactId, fields: Object.keys(patch) },
    sourceIp,
  });
  return updated;
}

async function setPrimaryContact(customerId, contactId, actor, sourceIp) {
  const contact = await prisma.customerContact.findFirst({ where: { id: contactId, customerId, isActive: true } });
  if (!contact) bad('Contact not found', 404);
  await prisma.$transaction(async (tx) => {
    await tx.customerContact.updateMany({
      where: { customerId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.customerContact.update({ where: { id: contactId }, data: { isPrimary: true } });
  });
  await logEvent({
    eventType: 'CUSTOMER_CONTACT_PRIMARY_SET',
    entityType: 'Customer',
    entityId: customerId,
    actorId: actor?.id,
    payload: { contactId },
    sourceIp,
  });
  return prisma.customerContact.findUnique({ where: { id: contactId } });
}

async function deleteContact(customerId, contactId, actor, sourceIp) {
  const contact = await prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
  if (!contact) bad('Contact not found', 404);
  await prisma.customerContact.delete({ where: { id: contactId } });
  // If we deleted the primary, promote the oldest remaining active to primary
  if (contact.isPrimary) {
    const next = await prisma.customerContact.findFirst({
      where: { customerId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (next) await prisma.customerContact.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  await logEvent({
    eventType: 'CUSTOMER_CONTACT_DELETED',
    entityType: 'Customer',
    entityId: customerId,
    actorId: actor?.id,
    payload: { contactId },
    sourceIp,
  });
  return { ok: true };
}

module.exports = {
  PAYMENT_TERMS,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deactivateCustomer,
  addContact,
  updateContact,
  setPrimaryContact,
  deleteContact,
};
