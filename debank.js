const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ethers } = require('ethers');

// Konfigurasi
const CONFIG = {
  DEBANK_API: 'https://pro-openapi.debank.com/v1',
  ACCESS_KEY: '3eff98c0b08e211fe4d7f3329842c57c58b9e264', // Ganti dengan access key Anda
  DELAY_MS: 100, // Delay antar request (0.1 detik)
  DEBUG: true, // Set false untuk disable debug log
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
    // Tambahkan 0x jika belum ada
    const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
    const wallet = new ethers.Wallet(pk);
    return wallet.address;
  } catch (error) {
    console.error(`Error converting private key: ${error.message}`);
    return null;
  }
}

// Fungsi untuk membaca daftar private keys dari file
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
        // Replace single quotes dengan double quotes untuk valid JSON
        const jsonData = data.replace(/'/g, '"');
        const parsed = JSON.parse(jsonData);
        
        if (Array.isArray(parsed)) {
          privateKeys = parsed.map(item => item.private_key).filter(pk => pk);
          console.log(`✅ File ditemukan: ${resolvedPath}`);
          console.log(`📋 Format: JSON/Dict`);
          console.log(`🔑 Total private keys: ${privateKeys.length}\n`);
          return privateKeys;
        }
      } catch (jsonError) {
        console.error(`❌ Error parsing JSON: ${jsonError.message}`);
        return null;
      }
    }
    
    // Format sederhana (private key per baris)
    privateKeys = data.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    console.log(`✅ File ditemukan: ${resolvedPath}`);
    console.log(`📋 Format: Plain text (per baris)`);
    console.log(`🔑 Total private keys: ${privateKeys.length}\n`);
    
    return privateKeys;
  } catch (error) {
    console.error(`❌ Error membaca file:`, error.message);
    return null;
  }
}

// Fungsi untuk mendapatkan total balance wallet
async function getWalletBalance(address) {
  try {
    const response = await axios.get(
      `${CONFIG.DEBANK_API}/user/total_balance`,
      {
        params: { id: address },
        headers: {
          'AccessKey': CONFIG.ACCESS_KEY,
          'Accept': 'application/json'
        }
      }
    );
    
    if (CONFIG.DEBUG) {
      console.log(`  [DEBUG] Balance API Response:`, JSON.stringify(response.data, null, 2));
    }
    
    return response.data;
  } catch (error) {
    console.error(`  ❌ Error getting balance: ${error.message}`);
    if (error.response) {
      console.error(`  [API Error] Status: ${error.response.status}, Data:`, error.response.data);
    }
    return null;
  }
}

// Fungsi untuk mendapatkan daftar chain yang digunakan
async function getWalletChains(address) {
  try {
    const response = await axios.get(
      `${CONFIG.DEBANK_API}/user/used_chain_list`,
      {
        params: { id: address },
        headers: {
          'AccessKey': CONFIG.ACCESS_KEY,
          'Accept': 'application/json'
        }
      }
    );
    
    if (CONFIG.DEBUG) {
      console.log(`  [DEBUG] Chains API Response:`, JSON.stringify(response.data, null, 2));
    }
    
    return response.data;
  } catch (error) {
    console.error(`  ❌ Error getting chains: ${error.message}`);
    if (error.response) {
      console.error(`  [API Error] Status: ${error.response.status}`);
    }
    return null;
  }
}

// Fungsi untuk mendapatkan token list dari semua chain
async function getAllTokens(address, chains) {
  const allCoins = {};
  
  if (!chains || chains.length === 0) return allCoins;
  
  for (const chain of chains) {
    try {
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
          }
        }
      );
      
      if (response.data && Array.isArray(response.data)) {
        response.data.forEach(token => {
          if (token.amount > 0) {
            allCoins[token.symbol] = (allCoins[token.symbol] || 0) + token.amount;
          }
        });
      }
      
      await delay(CONFIG.DELAY_MS);
    } catch (error) {
      // Skip chain jika error
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
  console.log('🚀 DeBank Batch Wallet Scanner (Private Key)');
  console.log('='.repeat(60));

  // Validasi access key
  if (CONFIG.ACCESS_KEY === 'YOUR_DEBANK_ACCESS_KEY_HERE') {
    console.error('\n❌ Error: Harap isi ACCESS_KEY di konfigurasi!');
    console.log('💡 Dapatkan access key di: https://debank.com/openapi');
    return;
  }

  // Input file path dari user
  console.log('\n📂 Masukkan path file private keys:');
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
  console.log(`📁 Results saved to: ${outputPath}`);
  console.log('='.repeat(60));
}

// Jalankan script
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
