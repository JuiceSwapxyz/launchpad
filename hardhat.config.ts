import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  // Citrea chain descriptor with hardfork history for forking support
  chainDescriptors: {
    5115: {
      name: "citrea",
      chainType: "generic",
      hardforkHistory: {
        chainstart: { blockNumber: 0 },
        homestead: { blockNumber: 0 },
        tangerineWhistle: { blockNumber: 0 },
        spuriousDragon: { blockNumber: 0 },
        byzantium: { blockNumber: 0 },
        constantinople: { blockNumber: 0 },
        petersburg: { blockNumber: 0 },
        istanbul: { blockNumber: 0 },
        muirGlacier: { blockNumber: 0 },
        berlin: { blockNumber: 0 },
        london: { blockNumber: 0 },
        arrowGlacier: { blockNumber: 0 },
        grayGlacier: { blockNumber: 0 },
        merge: { blockNumber: 0 },
        shanghai: { blockNumber: 0 },
        cancun: { blockNumber: 0 },
      },
      blockExplorers: {},
    },
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "generic",
      chainId: 5115,
      hardfork: "cancun",
      initialBaseFeePerGas: 0,
      mining: {
        auto: true,
        interval: 0,
      },
      allowBlocksWithSameTimestamp: true,
      forking: process.env.FORK_CITREA === "true" ? {
        url: process.env.CITREA_TESTNET_RPC || "https://rpc.testnet.citrea.xyz",
        enabled: true,
      } : undefined,
    },
    citreaTestnet: {
      type: "http",
      chainType: "generic",
      url: process.env.CITREA_TESTNET_RPC || "https://rpc.testnet.citrea.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    citreaMainnet: {
      type: "http",
      chainType: "generic",
      url: process.env.CITREA_MAINNET_RPC || "https://rpc.citrea.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  sourcify: {
    enabled: true,
  },
});
