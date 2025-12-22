const fs = require("fs");
const path = require("path");
const readline = require("readline");
const axios = require("axios");
const { Wallet } = require("ethers");
const readlineSync = require("readline-sync");

const BASE_URL = "https://api.debank.com";
const DELAY_MS = 1300;
const DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_FILE = `filter_wallet_${DATE}.txt`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =======================
// Debank API
// =======================
async function fetchDebank(address) {
  try {
    const bal = await axios.get(
      `${BASE_URL}/user/total_balance?id=${address}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const defi = await axios.get(
      `${BASE_URL}/user/all_complex_protocol_list?id=${address}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    return {
      totalUSD: bal.data?.total_usd_value || 0,
      hasDefi: Array.isArray(defi.data) && defi.data.length > 0
    };
  } catch {
    return null;
  }
}

// =======================
// MODE 1
// private_key.txt
// =======================
async function runMode1() {
  const INPUT = path.join(__dirname, "private_key.txt");

  if (!fs.existsSync(INPUT)) {
    console.log("❌ private_key.txt tidak ditemukan");
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT),
    crlfDelay: Infinity
  });

  let checked = 0;
  let saved = 0;

  for await (const line of rl) {
    const pk = line.trim();
    if (!/^(0x)?[a-fA-F0-9]{64}$/.test(pk)) continue;

    const privateKey = pk.startsWith("0x") ? pk : "0x" + pk;

    let wallet;
    try {
      wallet = new Wallet(privateKey);
    } catch {
      continue;
    }

    checked++;
    const address = wallet.address;
    console.log(`[MODE 1] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      await sleep(DELAY_MS);
      continue;
    }

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
`{
  'address': '${address}',
  'balance': ${debank.totalUSD},
  'private_key': '${privateKey.replace("0x","")}'
},
----------------------------
`
      );
      saved++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ MODE 1 SELESAI`);
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
}

// =======================
// MODE 2
// private_key1.txt (object python-style)
// =======================
async function runMode2() {
  const INPUT = path.join(__dirname, "private_key1.txt");

  if (!fs.existsSync(INPUT)) {
    console.log("❌ private_key1.txt tidak ditemukan");
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT),
    crlfDelay: Infinity
  });

  let checked = 0;
  let saved = 0;

  for await (const line of rl) {
    const match = line.match(
      /private_key\s*:\s*['"]?(0x)?([a-fA-F0-9]{64})['"]?\s*[},]*/
    );
    if (!match) continue;

    const privateKey = "0x" + match[2];

    let wallet;
    try {
      wallet = new Wallet(privateKey);
    } catch {
      continue;
    }

    checked++;
    const address = wallet.address;
    console.log(`[MODE 2] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      await sleep(DELAY_MS);
      continue;
    }

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
`{
  'address': '${address}',
  'balance': ${debank.totalUSD},
  'private_key': '${match[2]}'
},
----------------------------
`
      );
      saved++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ MODE 2 SELESAI`);
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
}

// =======================
// MENU
// =======================
console.log("=== FILTER WALLET ===");
console.log("1. Ambil dari private_key.txt");
console.log("2. Ambil dari private_key1.txt");

const choice = readlineSync.question("Pilih menu (1 / 2): ");

(async () => {
  if (choice === "1") {
    await runMode1();
  } else if (choice === "2") {
    await runMode2();
  } else {
    console.log("❌ Pilihan tidak valid");
  }
})();
