const express = require('express');
const crypto = require('crypto');
const actualService = require('../services/actualService');
const db = require('../db/database');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const router = express.Router();

// Helper to generate a secure validation token for a transaction ID
const generateToken = (id) => {
  return crypto
    .createHmac('sha256', process.env.DISCORD_CLIENT_SECRET || 'fallback_secret')
    .update(id)
    .digest('hex');
};

module.exports = (client) => {
  
  /**
   * 1. Webhook Endpoint: Receives a structured transaction object
   */
  router.post('/webhook/finance', async (req, res) => {
    try {
      const payload = req.body;
      console.log('[Webhook] Received transaction payload:', payload);

      // Validate required fields
      if (!payload.amount || !payload.account) {
        return res.status(400).json({ error: 'Missing required fields: amount and account are mandatory.' });
      }

      // Generate a unique transaction ID
      const txnId = 'txn_' + crypto.randomBytes(8).toString('hex');
      const type = payload.type || 'expense';

      // Save to SQLite
      db.saveTransaction(txnId, payload, 'pending');

      // Generate verification token
      const token = generateToken(txnId);
      const modifyUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/finance/modify?id=${txnId}&token=${token}`;

      // Notify Owner via Discord DM
      const ownerId = process.env.OWNER_ID;
      if (!ownerId) {
        throw new Error('OWNER_ID is not configured in environment variables.');
      }

      const owner = await client.users.fetch(ownerId);
      if (!owner) {
        throw new Error(`Could not fetch owner user with ID: ${ownerId}`);
      }

      // Build beautiful DM Embed
      const amountFormatted = actualService.formatToIDR(payload.amount);
      const embed = new EmbedBuilder()
        .setTitle('📥 Incoming Transaction Notification')
        .setDescription(`A new transaction is pending your approval.`)
        .addFields(
          { name: 'Amount', value: `**${amountFormatted}**`, inline: true },
          { name: 'Type', value: type.toUpperCase(), inline: true },
          { name: 'Date', value: payload.date || new Date().toISOString().split('T')[0], inline: true },
          { name: 'Account', value: payload.account || payload.source_account || 'N/A', inline: true }
        )
        .setColor(0xFFA500) // Warning Orange for pending
        .setTimestamp();

      if (type === 'transfer') {
        embed.addFields({ name: 'Destination Account', value: payload.destination_account || 'N/A', inline: true });
      } else {
        embed.addFields(
          { name: 'Category', value: payload.category || 'N/A', inline: true },
          { name: 'Payee', value: payload.payee_name || 'N/A', inline: true }
        );
      }

      if (payload.description) {
        embed.addFields({ name: 'Description', value: payload.description, inline: false });
      }

      // Buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tx_accept_${txnId}`)
          .setLabel('Accept')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`tx_deny_${txnId}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`tx_modify_${txnId}`)
          .setLabel('Modify')
          .setStyle(ButtonStyle.Primary)
      );

      // Send the DM
      const message = await owner.send({ embeds: [embed], components: [row] });

      // Save the message and channel IDs so we can edit it later
      db.updateTransactionMessage(txnId, message.id, message.channel.id);

      return res.status(201).json({ success: true, transaction_id: txnId });

    } catch (error) {
      console.error('[Webhook Error]:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * 2. GET /finance/modify: Loads EJS template for transaction modification
   */
  router.get('/finance/modify', async (req, res) => {
    try {
      const { id, token } = req.query;

      if (!id || !token) {
        return res.status(400).send('Missing transaction ID or authorization token.');
      }

      // Cryptographically verify token
      const expectedToken = generateToken(id);
      if (token !== expectedToken) {
        return res.status(403).send('Invalid or expired authorization token.');
      }

      const transaction = db.getTransaction(id);
      if (!transaction) {
        return res.status(404).send('Transaction not found.');
      }

      if (transaction.status !== 'pending') {
        return res.send(`
          <html>
            <body style="background-color: #111827; color: #f3f4f6; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column;">
              <h2 style="color: #ef4444;">Already Processed</h2>
              <p>This transaction has already been ${transaction.status}. You can close this tab.</p>
            </body>
          </html>
        `);
      }

      // Load live accounts & categories from Actual Budget for the select fields
      await actualService.init();
      const accounts = await actualService.getAccounts();
      const categories = await actualService.getCategories();
      await actualService.shutdown();

      const type = transaction.payload.type || 'expense';

      return res.render('modify', {
        transaction,
        token,
        accounts,
        categories,
        type
      });

    } catch (error) {
      console.error('[GET Modify Error]:', error);
      return res.status(500).send(`An error occurred: ${error.message}`);
    }
  });

  /**
   * 3. POST /finance/modify: Receives submission, updates Actual Budget, SQLite & Discord DM
   */
  router.post('/finance/modify', async (req, res) => {
    try {
      const { id, token, type, date, amount, payee_name, account, destination_account, category, description } = req.body;

      if (!id || !token) {
        return res.status(400).send('Missing transaction ID or token.');
      }

      // Verify token
      const expectedToken = generateToken(id);
      if (token !== expectedToken) {
        return res.status(403).send('Invalid or expired authorization token.');
      }

      const transaction = db.getTransaction(id);
      if (!transaction || transaction.status !== 'pending') {
        return res.status(400).send('Transaction not found or already processed.');
      }

      console.log(`[Modify] Processing submission for ${id} (Type: ${type}, Amount: ${amount})`);

      // Initialize Actual Budget and create transaction
      await actualService.init();
      await actualService.createActualTransaction({
        type,
        date,
        amount: parseFloat(amount),
        payee_name,
        account,
        destination_account,
        category,
        description
      });
      await actualService.shutdown();

      // Update SQLite status
      db.updateTransactionStatus(id, 'accepted');

      // Update Discord DM to show success!
      if (transaction.message_id && transaction.channel_id) {
        try {
          const channel = await client.channels.fetch(transaction.channel_id);
          const message = await channel.messages.fetch(transaction.message_id);

          const updatedEmbed = EmbedBuilder.from(message.embeds[0])
            .setColor(0x00FF00) // Green for accepted
            .setTitle('✅ Transaction Accepted & Logged (Modified)')
            .setDescription(`This transaction was modified via Web-UI and logged successfully to Actual Budget.`);

          // Clear components/buttons so they can't be clicked again
          await message.edit({ embeds: [updatedEmbed], components: [] });
        } catch (err) {
          console.error('[Modify] Error updating Discord message:', err.message);
        }
      }

      return res.send(`
        <html>
          <body style="background-color: #111827; color: #f3f4f6; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column;">
            <h2 style="color: #10b981;">📝 Saved Successfully!</h2>
            <p>The transaction was updated and logged to Actual Budget.</p>
            <p style="font-size: 0.85rem; color: #9ca3af;">You can close this window now.</p>
          </body>
        </html>
      `);

    } catch (error) {
      console.error('[POST Modify Error]:', error);
      return res.status(500).send(`Failed to update transaction: ${error.message}`);
    }
  });

  return router;
};
