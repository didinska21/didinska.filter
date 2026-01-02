const fs = require("fs");
const path = require("path");
const readline = require("readline");
const axios = require("axios");
const { Wallet } = require("ethers");
const readlineSync = require("readline-sync");

const BASE_URL = "https://api.debank.com";
const DELAY_MS = 3000; // Increased to 3 seconds
const RETRY_DELAY_MS = 10000; // 10 seconds on rate limit
const MAX_RETRIES = 3;
const DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_FILE = `filter_wallet_${DATE}.txt`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Random User-Agent pool
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
];

function getRandomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// =======================
// Debank API with Retry
// =======================
async function fetchDebank(address, retryCount = 0) {
  try {
    const headers = {
      "User-Agent": getRandomUA(),
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://debank.com/",
      "Origin": "https://debank.com"
    };

    const bal = await axios.get(
      `${BASE_URL}/user/total_balance?id=${address}`,
      { headers, timeout: 15000 }
    );

    await sleep(500); // Small delay between requests

    const defi = await axios.get(
      `${BASE_URL}/user/all_complex_protocol_list?id=${address}`,
      { headers, timeout: 15000 }
    );

    return {
      totalUSD: bal.data?.total_usd_value || 0,
      hasDefi: Array.isArray(defi.data) && defi.data.length > 0
    };
  } catch (err) {
    if (err.response?.status === 429) {
      // Rate limit hit
      if (retryCount < MAX_RETRIES) {
        const waitTime = RETRY_DELAY_MS * (retryCount + 1);
        console.log(`   ⏳ Rate limited. Waiting ${waitTime/1000}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await sleep(waitTime);
        return fetchDebank(address, retryCount + 1);
      } else {
        console.log(`   ❌ Rate limit exceeded after ${MAX_RETRIES} retries`);
        return null;
      }
    } else {
      console.log(`   ⚠️  Error: ${err.message}`);
      return null;
    }
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
  let skipped = 0;

  for await (const line of rl) {
    const pk = line.trim();
    if (!pk || pk.length === 0) continue;
    
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
    console.log(`\n[MODE 1] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`   💰 Balance: $${debank.totalUSD.toFixed(2)} | DeFi: ${debank.hasDefi ? '✓' : '✗'}`);

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
        `{\n  'address': '${address}',\n  'balance': ${debank.totalUSD},\n  'private_key': '${cleanPk}'\n},\n----------------------------\n`
      );
      saved++;
      console.log(`   ✅ SAVED TO ${OUTPUT_FILE}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ MODE 1 SELESAI`);
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
  console.log(`⏭️  Skipped : ${skipped}`);
  console.log(`📄 File    : ${OUTPUT_FILE}`);
  console.log(`${"=".repeat(50)}`);
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
  let skipped = 0;

  for await (const line of rl) {
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
    console.log(`\n[MODE 2] [${checked}] ${address}`);

    const debank = await fetchDebank(address);
    if (!debank) {
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`   💰 Balance: $${debank.totalUSD.toFixed(2)} | DeFi: ${debank.hasDefi ? '✓' : '✗'}`);

    if (debank.totalUSD > 0 || debank.hasDefi) {
      fs.appendFileSync(
        OUTPUT_FILE,
        `{\n  'address': '${address}',\n  'balance': ${debank.totalUSD},\n  'private_key': '${cleanPk}'\n},\n----------------------------\n`
      );
      saved++;
      console.log(`   ✅ SAVED TO ${OUTPUT_FILE}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ MODE 2 SELESAI`);
  console.log(`🔍 Dicek   : ${checked}`);
  console.log(`💾 Disimpan: ${saved}`);
  console.log(`⏭️  Skipped : ${skipped}`);
  console.log(`📄 File    : ${OUTPUT_FILE}`);
  console.log(`${"=".repeat(50)}`);
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
  console.log(`⏱️  Delay: ${DELAY_MS}ms per wallet`);
  console.log(`🔄 Retry: ${MAX_RETRIES}x on rate limit`);
  console.log("=================================\n");

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
