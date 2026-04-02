#!/usr/bin/env node
// Simulates multi-tab presence scenarios between Alice and Bob.
// Watches server logs for expected behavior.

const WebSocket = require('ws');

const ALICE_TOKEN = process.env.ALICE_TOKEN;
const BOB_TOKEN = process.env.BOB_TOKEN;
if (!ALICE_TOKEN || !BOB_TOKEN) {
  console.error('Usage: ALICE_TOKEN=... BOB_TOKEN=... node test-presence.js');
  process.exit(1);
}

const WS_URL = 'ws://localhost:3001/ws';

function connect(name, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    ws.on('open', () => {
      console.log(`  ✓ ${name} connected`);
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'connected') {
        resolve(ws);
      } else if (msg.type === 'presence_change') {
        const arrow = msg.notify ? '🔔' : '🔕';
        console.log(`  ${arrow} ${name} sees: ${msg.user?.displayName} → ${msg.status} (notify=${msg.notify})`);
      } else if (msg.type === 'force_logout') {
        console.log(`  ⚠️  ${name} received force_logout: ${msg.reason}`);
      } else if (msg.type === 'heartbeat_ack') {
        // silent
      } else {
        console.log(`  📨 ${name} got: ${msg.type}`);
      }
    });
    ws.on('close', (code, reason) => {
      console.log(`  ✗ ${name} disconnected (code=${code})`);
    });
    ws.on('error', (err) => {
      reject(err);
    });
  });
}

function close(name, ws) {
  return new Promise((resolve) => {
    ws.on('close', () => resolve());
    console.log(`  → Closing ${name}`);
    ws.close();
  });
}

function sleep(ms, label) {
  if (label) console.log(`  ⏱  waiting ${ms / 1000}s (${label})...`);
  return new Promise(r => setTimeout(r, ms));
}

function sendHeartbeat(ws) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'heartbeat' }));
  }
}

async function run() {
  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 1: First login — Bob should see Alice come online');
  console.log('═══════════════════════════════════════════');

  const bob1 = await connect('Bob-tab1', BOB_TOKEN);
  // Send a heartbeat so Bob's presence is active
  sendHeartbeat(bob1);
  await sleep(500, 'let Bob settle');

  const alice1 = await connect('Alice-tab1', ALICE_TOKEN);
  sendHeartbeat(alice1);
  await sleep(1000, 'wait for 300ms notify timer + delivery');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 2: Alice opens second tab — Bob should NOT see another notification');
  console.log('═══════════════════════════════════════════');

  const alice2 = await connect('Alice-tab2', ALICE_TOKEN);
  sendHeartbeat(alice2);
  await sleep(1000, 'any spurious notification?');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 3: Close one of Alice\'s tabs — Bob should see NO change');
  console.log('═══════════════════════════════════════════');

  await close('Alice-tab1', alice1);
  await sleep(2000, 'should see no presence change');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 4: Close Alice\'s last tab — Bob should see OFFLINE after 5s grace');
  console.log('═══════════════════════════════════════════');

  await close('Alice-tab2', alice2);
  await sleep(7000, 'grace timer is 5s, adding margin');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 5: Alice reconnects — Bob should see ONLINE notification');
  console.log('═══════════════════════════════════════════');

  const alice3 = await connect('Alice-tab3', ALICE_TOKEN);
  sendHeartbeat(alice3);
  await sleep(1000, 'wait for notify timer');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 6: Close Alice again — Bob should see OFFLINE after grace');
  console.log('═══════════════════════════════════════════');

  await close('Alice-tab3', alice3);
  await sleep(7000, 'grace timer + margin');

  console.log('\n═══════════════════════════════════════════');
  console.log('SCENARIO 7: Alice reconnects + quick page refresh (disconnect < 5s) — NO offline flap');
  console.log('═══════════════════════════════════════════');

  const alice4 = await connect('Alice-tab4', ALICE_TOKEN);
  sendHeartbeat(alice4);
  await sleep(1000, 'let notify fire');

  console.log('  → Simulating page refresh (close + reconnect within 2s)');
  await close('Alice-tab4', alice4);
  await sleep(2000, 'within grace period');
  const alice5 = await connect('Alice-tab5', ALICE_TOKEN);
  sendHeartbeat(alice5);
  await sleep(7000, 'bob should NOT see offline→online flap');

  console.log('\n═══════════════════════════════════════════');
  console.log('DONE — cleaning up');
  console.log('═══════════════════════════════════════════');

  await close('Alice-tab5', alice5);
  await close('Bob-tab1', bob1);
  await sleep(1000);

  process.exit(0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
