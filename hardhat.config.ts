import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import "@nomicfoundation/hardhat-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
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
  test: {
    mocha: {
      timeout: 40000,
    },
  },
});
