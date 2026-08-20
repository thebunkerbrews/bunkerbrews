const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Square Client
let squareClient = null;
const squareToken = process.env.SQUARE_ACCESS_TOKEN;
const isSquarePlaceholder = !squareToken || squareToken.includes('placeholder');

if (!isSquarePlaceholder) {
  try {
    const { Client, Environment } = require('square');
    squareClient = new Client({
      accessToken: squareToken,
      environment: (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production' 
        ? Environment.Production 
        : Environment.Sandbox,
    });
  } catch (err) {
    console.warn('Square SDK initialization skipped:', err.message);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Public Config Endpoint
app.get('/api/config', (req, res) => {
  res.json({
    squareApplicationId: process.env.SQUARE_APPLICATION_ID || '',
    squareLocationId: process.env.SQUARE_LOCATION_ID || '',
    isSquareConfigured: Boolean(squareClient && process.env.SQUARE_LOCATION_ID),
    environment: process.env.SQUARE_ENVIRONMENT || 'sandbox'
  });
});

// Endpoint to Create a Square Checkout Payment Link
app.post('/api/create-checkout-session', async (req, res) => {
  if (!squareClient || !process.env.SQUARE_LOCATION_ID) {
    return res.status(500).json({ 
      error: 'Square is not configured. Please add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID to your .env file.' 
    });
  }

  try {
    const { items, bottleDiscountCount } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }

    const domain = process.env.DOMAIN || `http://localhost:${port}`;
    const idempotencyKey = crypto.randomUUID();

    // Map cart items into Square Line Items
    const lineItems = items.map(item => ({
      name: `${item.name} (${item.size})`,
      quantity: String(item.quantity),
      basePriceMoney: {
        amount: BigInt(Math.round(item.price * 100)), // in pence
        currency: 'GBP',
      },
      note: 'Handcrafted craft cola syrup concentrate',
    }));

    // Optional discounts (Bottle Return perk)
    const discounts = [];
    if (bottleDiscountCount && bottleDiscountCount > 0) {
      const discountAmountPence = Math.round(bottleDiscountCount * 150); // £1.50 ea
      discounts.push({
        name: `Bottle Return Credit (${bottleDiscountCount}x £1.50)`,
        amountMoney: {
          amount: BigInt(discountAmountPence),
          currency: 'GBP',
        },
        scope: 'ORDER',
      });
    }

    // Call Square Checkout API to create a hosted checkout link
    const response = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems,
        discounts: discounts.length > 0 ? discounts : undefined,
      },
      checkoutOptions: {
        redirectUrl: `${domain}/?status=success#rations`,
        askForShippingAddress: true,
        merchantSupportEmail: process.env.CONTACT_EMAIL || 'thebunkerbrews@gmail.com',
        enableCoupon: true,
      },
    });

    const paymentLink = response.result.paymentLink;
    res.json({ id: paymentLink.id, url: paymentLink.url });
  } catch (error) {
    console.error('Square Checkout Error:', error);
    res.status(500).json({ error: error.message || 'Failed to create Square checkout link.' });
  }
});

app.listen(port, () => {
  console.log(`⚡ Bunker Brews server operational at http://localhost:${port}`);
  console.log(`💳 Square status: ${squareClient ? 'CONNECTED (' + (process.env.SQUARE_ENVIRONMENT || 'sandbox') + ')' : 'STANDBY (Using placeholder credentials)'}`);
});
