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
      { 
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000
      }
    );

    const defi = await axios.get(
      `${BASE_URL}/user/all_complex_protocol_list?id=${address}`,
      { 
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000
      }
    );

    return {
      totalUSD: bal.data?.total_usd_value || 0,
      hasDefi: Array.isArray(defi.data) && defi.data.length > 0
    };
  } catch (err) {
    console.log(`   ⚠️  Error fetching data: ${err.message}`);
    return null;
  }
}

// =======================
// MODE 1: private_key.txt
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
    if (!pk || pk.length === 0) continue;
    
    // Validasi format private key (64 karakter hex)
    const cleanPk = pk.replace(/^0x/, '');
    if (!/^[a-fA-F0-9]{64}$/.test(cleanPk)) {
      console.log(`   ⚠️  Invalid format: ${pk.substring(0, 10)}...`);
      continue;
    }

    const privateKey = "0x" + cleanPk;

    let wallet;
    try {
      wallet = new Wallet(privateKey);
    } catch (err) {
      console.log(`   ⚠️  Invalid key: ${err.message}`);
      continue;
    }

    checked++;
    const address = wallet.address;
    console.log(`[MODE 1] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      console.log(`   ⏭️  Skipped (API error)`);
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`   💰 Balance: $${debank.totalUSD.toFixed(2)} | DeFi: ${debank.hasDefi ? 'Yes' : 'No'}`);

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
        `{\n  'address': '${address}',\n  'balance': ${debank.totalUSD},\n  'private_key': '${cleanPk}'\n},\n----------------------------\n`
      );
      saved++;
      console.log(`   ✅ SAVED!`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ MODE 1 SELESAI`);
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
  console.log(`📄 File    : ${OUTPUT_FILE}`);
}

// =======================
// MODE 2: private_key1.txt
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
    // Pattern yang lebih fleksibel untuk menangkap private key
    const match = line.match(
      /['"]?private_key['"]?\s*:\s*['"]?(0x)?([a-fA-F0-9]{64})['"]?/i
    );
    
    if (!match) continue;

    const cleanPk = match[2];
    const privateKey = "0x" + cleanPk;

    let wallet;
    try {
      wallet = new Wallet(privateKey);
    } catch (err) {
      console.log(`   ⚠️  Invalid key: ${err.message}`);
      continue;
    }

    checked++;
    const address = wallet.address;
    console.log(`[MODE 2] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      console.log(`   ⏭️  Skipped (API error)`);
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`   💰 Balance: $${debank.totalUSD.toFixed(2)} | DeFi: ${debank.hasDefi ? 'Yes' : 'No'}`);

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
        `{\n  'address': '${address}',\n  'balance': ${debank.totalUSD},\n  'private_key': '${cleanPk}'\n},\n----------------------------\n`
      );
      saved++;
      console.log(`   ✅ SAVED!`);
    }

    await sleep(DELAY_MS);
  }

  console.log("\n✅ MODE 2 SELESAI");
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
  console.log(`📄 File    : ${OUTPUT_FILE}`);
}

// =======================
// MAIN
// =======================
async function main() {
  console.log("=================================");
  console.log("===   FILTER WALLET SCRIPT    ===");
  console.log("=================================");
  console.log("1. Ambil dari private_key.txt");
  console.log("2. Ambil dari private_key1.txt");
  console.log("=================================");

  const choice = readlineSync.question("Pilih menu (1 / 2): ");

  if (choice === "1") {
    await runMode1();
  } else if (choice === "2") {
    await runMode2();
  } else {
    console.log("❌ Pilihan tidak valid");
  }
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
