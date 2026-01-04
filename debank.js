const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ethers } = require('ethers');
require('dotenv').config(); // Tambahan untuk env variables

// Konfigurasi
const CONFIG = {
  DEBANK_API: 'https://pro-openapi.debank.com/v1',
  ACCESS_KEY: process.env.DEBANK_ACCESS_KEY || '', // Dari environment variable
  DELAY_MS: 500, // Naikkan dari 100ms ke 500ms untuk menghindari rate limit
  MAX_RETRIES: 3, // Jumlah retry jika request gagal
  RETRY_DELAY_MS: 2000, // Delay antar retry
  DEBUG: process.env.DEBUG === 'true' || false,
};

// Fungsi untuk input dari user
function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

// Fungsi delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi exponential backoff untuk retry
async function exponentialBackoff(attempt) {
  const backoffTime = CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt);
  console.log(`  ⏳ Retrying in ${backoffTime / 1000}s...`);
  await delay(backoffTime);
}

// Fungsi untuk generate nama file output
function generateOutputFilename() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `privatekey_${day}-${month}-${year}.txt`;
}

// Fungsi untuk convert private key ke address
function privateKeyToAddress(privateKey) {
  try {
    const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
    const wallet = new ethers.Wallet(pk);
    return wallet.address;
  } catch (error) {
    console.error(`  ❌ Error converting private key: ${error.message}`);
    return null;
  }
}

// Fungsi untuk membaca daftar private keys dari file dengan JSON parsing yang lebih robust
function readPrivateKeys(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ File tidak ditemukan: ${resolvedPath}`);
      return null;
    }

    const data = fs.readFileSync(resolvedPath, 'utf8');
    let privateKeys = [];
    
    // Cek apakah format JSON/Python dict
    if (data.trim().startsWith('[')) {
      try {
        // Parsing yang lebih robust untuk Python-style dict
        let jsonData = data.trim();
        
        // Replace single quotes dengan double quotes HANYA untuk keys dan string values
        // Menggunakan regex yang lebih aman
        jsonData = jsonData
          .replace(/(\w+):/g, '"$1":')  // Wrap keys dengan quotes
          .replace(/:\s*'([^']*)'/g, ': "$1"')  // Replace single quotes di values
          .replace(/,\s*}/g, '}')  // Remove trailing commas
          .replace(/,\s*]/g, ']'); // Remove trailing commas di array
        
        const parsed = JSON.parse(jsonData);
        
        if (Array.isArray(parsed)) {
          privateKeys = parsed
            .map(item => {
              if (typeof item === 'string') return item;
              return item.private_key || item.privateKey || item.key;
            })
            .filter(pk => pk && pk.length > 0);
          
          console.log(`✅ File ditemukan: ${resolvedPath}`);
          console.log(`📋 Format: JSON/Dict`);
          console.log(`🔑 Total private keys: ${privateKeys.length}\n`);
          return privateKeys;
        }
      } catch (jsonError) {
        console.error(`❌ Error parsing JSON: ${jsonError.message}`);
        console.log(`💡 Pastikan format file valid. Mencoba format plain text...\n`);
        // Fallback ke plain text parsing
      }
    }
    
    // Format sederhana (private key per baris)
    privateKeys = data.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));
    
    console.log(`✅ File ditemukan: ${resolvedPath}`);
    console.log(`📋 Format: Plain text (per baris)`);
    console.log(`🔑 Total private keys: ${privateKeys.length}\n`);
    
    return privateKeys;
  } catch (error) {
    console.error(`❌ Error membaca file:`, error.message);
    return null;
  }
}

// Fungsi wrapper untuk API call dengan retry mechanism
async function apiCallWithRetry(apiFunction, ...args) {
  let lastError = null;
  
  for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
    try {
      const result = await apiFunction(...args);
      return result;
    } catch (error) {
      lastError = error;
      
      // Log error dengan detail
      console.error(`  ⚠️ Attempt ${attempt + 1}/${CONFIG.MAX_RETRIES} failed: ${error.message}`);
      
      if (error.response) {
        console.error(`  [API Error] Status: ${error.response.status}`);
        
        // Jangan retry jika error 401 (unauthorized) atau 403 (forbidden)
        if (error.response.status === 401 || error.response.status === 403) {
          console.error(`  ❌ Authentication error - check your ACCESS_KEY`);
          throw error;
        }
      }
      
      // Retry dengan exponential backoff jika bukan attempt terakhir
      if (attempt < CONFIG.MAX_RETRIES - 1) {
        await exponentialBackoff(attempt);
      }
    }
  }
  
  // Semua retry gagal
  throw lastError;
}

// Fungsi untuk mendapatkan total balance wallet
async function getWalletBalance(address) {
  const apiCall = async () => {
    const response = await axios.get(
      `${CONFIG.DEBANK_API}/user/total_balance`,
      {
        params: { id: address },
        headers: {
          'AccessKey': CONFIG.ACCESS_KEY,
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );
    
    if (CONFIG.DEBUG) {
      console.log(`  [DEBUG] Balance API Response:`, JSON.stringify(response.data, null, 2));
    }
    
    return response.data;
  };
  
  try {
    return await apiCallWithRetry(apiCall);
  } catch (error) {
    console.error(`  ❌ Failed to get balance after ${CONFIG.MAX_RETRIES} attempts`);
    return null;
  }
}

// Fungsi untuk mendapatkan daftar chain yang digunakan
async function getWalletChains(address) {
  const apiCall = async () => {
    const response = await axios.get(
      `${CONFIG.DEBANK_API}/user/used_chain_list`,
      {
        params: { id: address },
        headers: {
          'AccessKey': CONFIG.ACCESS_KEY,
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (CONFIG.DEBUG) {
      console.log(`  [DEBUG] Chains API Response:`, JSON.stringify(response.data, null, 2));
    }
    
    return response.data;
  };
  
  try {
    return await apiCallWithRetry(apiCall);
  } catch (error) {
    console.error(`  ❌ Failed to get chains after ${CONFIG.MAX_RETRIES} attempts`);
    return null;
  }
}

// Fungsi untuk mendapatkan token list dari semua chain dengan proper error logging
async function getAllTokens(address, chains) {
  const allCoins = {};
  
  if (!chains || chains.length === 0) return allCoins;
  
  for (const chain of chains) {
    try {
      const apiCall = async () => {
        const response = await axios.get(
          `${CONFIG.DEBANK_API}/user/token_list`,
          {
            params: { 
              id: address,
              chain_id: chain.id
            },
            headers: {
              'AccessKey': CONFIG.ACCESS_KEY,
              'Accept': 'application/json'
            },
            timeout: 10000
          }
        );
        return response.data;
      };
      
      const tokens = await apiCallWithRetry(apiCall);
      
      if (tokens && Array.isArray(tokens)) {
        tokens.forEach(token => {
          if (token.amount > 0) {
            allCoins[token.symbol] = (allCoins[token.symbol] || 0) + token.amount;
          }
        });
      }
      
      await delay(CONFIG.DELAY_MS);
      
    } catch (error) {
      // Log error tapi lanjutkan ke chain berikutnya
      console.error(`  ⚠️ Error getting tokens from chain ${chain.id}: ${error.message}`);
      if (CONFIG.DEBUG && error.response) {
        console.error(`  [DEBUG] Status: ${error.response.status}, Data:`, error.response.data);
      }
    }
  }
  
  return allCoins;
}

// Fungsi untuk scan satu wallet
async function scanWallet(privateKey, index, total) {
  const address = privateKeyToAddress(privateKey);
  
  if (!address) {
    console.log(`\n[${index}/${total}] ❌ Invalid private key`);
    return null;
  }
  
  console.log(`\n[${index}/${total}] 🔍 Scanning: ${address}`);
  
  const result = {
    address: address,
    balance: 0,
    chains: [],
    coins: {},
    private_key: privateKey.replace('0x', '')
  };

  // Get total balance
  console.log('  ├─ Getting balance...');
  const balanceData = await getWalletBalance(address);
  if (balanceData) {
    result.balance = balanceData.total_usd_value || 0;
  }
  await delay(CONFIG.DELAY_MS);

  // Get used chains
  console.log('  ├─ Getting chains...');
  const chainsData = await getWalletChains(address);
  if (chainsData && Array.isArray(chainsData)) {
    result.chains = chainsData.map(c => c.id);
  }
  await delay(CONFIG.DELAY_MS);

  // Get all tokens from all chains
  console.log('  └─ Getting tokens...');
  result.coins = await getAllTokens(address, chainsData);
  
  // Tampilkan summary
  console.log(`  ✅ Balance: $${result.balance.toFixed(2)} | Chains: ${result.chains.length} | Coins: ${Object.keys(result.coins).length}`);
  
  return result;
}

// Fungsi untuk save hasil ke file
function saveResults(results, outputFile) {
  // Sort by balance (tertinggi dulu)
  const sortedResults = [...results]
    .filter(r => r !== null)
    .sort((a, b) => b.balance - a.balance);
  
  // Format as JSON array tapi dengan single quotes seperti Python
  const jsonString = JSON.stringify(sortedResults, null, 2)
    .replace(/"/g, "'");
  
  fs.writeFileSync(outputFile, jsonString, 'utf8');
  
  return sortedResults;
}

// Fungsi utama
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 DeBank Batch Wallet Scanner (Private Key) - v2.0');
  console.log('='.repeat(60));

  // Validasi access key
  if (!CONFIG.ACCESS_KEY || CONFIG.ACCESS_KEY.trim() === '') {
    console.error('\n❌ Error: ACCESS_KEY tidak ditemukan!');
    console.log('💡 Buat file .env dan tambahkan:');
    console.log('   DEBANK_ACCESS_KEY=your_access_key_here');
    console.log('\n   Dapatkan access key di: https://debank.com/openapi');
    return;
  }

  console.log(`✅ Access Key loaded: ${CONFIG.ACCESS_KEY.substring(0, 8)}...${CONFIG.ACCESS_KEY.slice(-4)}`);
  console.log(`⚙️  Retry mechanism: ${CONFIG.MAX_RETRIES} attempts with exponential backoff`);
  console.log(`⏱️  Delay between requests: ${CONFIG.DELAY_MS}ms\n`);

  // Input file path dari user
  console.log('📂 Masukkan path file private keys:');
  console.log('   Contoh:');
  console.log('   - pvkey1.txt (file di folder yang sama)');
  console.log('   - /pvkey/pvkey1.txt (folder pvkey di root)');
  console.log('   - ./pvkey/pvkey1.txt (folder pvkey di folder saat ini)');
  console.log('   - ../pvkey/pvkey1.txt (folder pvkey di parent folder)\n');
  
  const filePath = await question('Path file: ');
  
  if (!filePath || filePath.trim() === '') {
    console.error('\n❌ Path file tidak boleh kosong!');
    return;
  }

  console.log('');

  // Baca daftar private keys
  const privateKeys = readPrivateKeys(filePath.trim());
  
  if (!privateKeys || privateKeys.length === 0) {
    return;
  }

  // Scan semua wallet
  const results = [];
  for (let i = 0; i < privateKeys.length; i++) {
    const result = await scanWallet(privateKeys[i], i + 1, privateKeys.length);
    if (result) {
      results.push(result);
    }
    
    // Delay sebelum wallet berikutnya
    if (i < privateKeys.length - 1) {
      await delay(CONFIG.DELAY_MS);
    }
  }

  // Generate output filename
  const outputFile = generateOutputFilename();
  const outputPath = path.resolve(outputFile);

  // Save hasil ke file (sorted by balance)
  const sortedResults = saveResults(results, outputPath);

  // Tampilkan summary di terminal
  console.log('\n' + '='.repeat(60));
  console.log('📊 SCAN SUMMARY (Sorted by Balance)');
  console.log('='.repeat(60));
  
  let totalValue = 0;
  sortedResults.forEach((r, idx) => {
    totalValue += r.balance;
    const coinsCount = Object.keys(r.coins).length;
    console.log(`${idx + 1}. ${r.address.substring(0, 10)}...${r.address.slice(-8)} = $${r.balance.toFixed(2)} | ${r.chains.length} chains | ${coinsCount} coins`);
  });
  
  console.log('-'.repeat(60));
  console.log(`💰 Total Portfolio Value: $${totalValue.toFixed(2)}`);
  console.log(`📊 Successful scans: ${sortedResults.length}/${privateKeys.length}`);
  console.log(`📁 Results saved to: ${outputPath}`);
  console.log('='.repeat(60));
}

// Jalankan script
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  if (CONFIG.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
