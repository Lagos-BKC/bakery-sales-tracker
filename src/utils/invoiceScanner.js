// Uses Claude's vision capability to read a photographed/scanned invoice and
// pull out structured sale data. Requires ANTHROPIC_API_KEY to be set (the
// Railway service owner adds this themselves in the dashboard - the app
// never stores or transmits it anywhere else). If it isn't set, callers get
// a clear, actionable error instead of a crash.

const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      'Invoice photo scanning is not configured. An administrator needs to add an ' +
      'ANTHROPIC_API_KEY environment variable in Railway (Settings > Variables) to enable it.'
    );
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const EXTRACT_TOOL = {
  name: 'record_invoice_data',
  description: 'Records the structured data extracted from a photographed sales invoice/receipt.',
  input_schema: {
    type: 'object',
    properties: {
      sold_to: { type: 'string', description: 'The customer/business name from the "Sold To", "Bill To", or "Customer" field. Empty string if not visible.' },
      transaction_date: { type: 'string', description: 'The invoice/transaction date, formatted as YYYY-MM-DD. Empty string if not visible or not determinable.' },
      line_items: {
        type: 'array',
        description: 'Every product/line item row on the invoice.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'The product name/description exactly as written on the invoice.' },
            quantity: { type: 'number', description: 'Quantity sold. Default to 1 if not explicitly shown.' },
            unit_price: { type: 'number', description: 'Price per unit. If only a line total is shown, divide by quantity.' },
          },
          required: ['description', 'quantity', 'unit_price'],
        },
      },
      amount_paid: { type: 'number', description: 'Amount already paid, if the invoice indicates it was paid or partially paid. 0 if it looks unpaid or payment status is unclear.' },
      payment_method: { type: 'string', description: 'One of Cash, E-transfer, Cheque, Credit/Debit, Bank Transfer, Other - only if clearly indicated, else empty string.' },
      notes: { type: 'string', description: 'Any invoice/reference number or other relevant note worth carrying over. Empty string if none.' },
    },
    required: ['sold_to', 'transaction_date', 'line_items', 'amount_paid', 'payment_method', 'notes'],
  },
};

async function extractInvoiceData(imageBase64, mediaType) {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'record_invoice_data' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        {
          type: 'text',
          text: 'This is a photo of a sales invoice or receipt for a bakery\'s B2B customer. ' +
            'Read it carefully and call record_invoice_data with everything you can determine. ' +
            'If a field is not visible or not applicable, use an empty string (or 0 for amount_paid) rather than guessing.',
        },
      ],
    }],
  });

  const toolUse = message.content.find(b => b.type === 'tool_use' && b.name === 'record_invoice_data');
  if (!toolUse) {
    const err = new Error('Could not read structured data from that photo. Try a clearer, well-lit image.');
    err.code = 'EXTRACTION_FAILED';
    throw err;
  }
  return toolUse.input;
}

module.exports = { extractInvoiceData };
