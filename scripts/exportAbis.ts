import * as fs from "fs";
import * as path from "path";

const ARTIFACTS_PATH = path.join(process.cwd(), "artifacts/contracts");
const ABIS_EXPORT_PATH = path.join(process.cwd(), "exports/abis");

const contractABI = [
  {
    from: `${ARTIFACTS_PATH}/TokenFactory.sol/TokenFactory.json`,
    to: `${ABIS_EXPORT_PATH}/TokenFactory.ts`,
    exportName: "TokenFactoryABI",
  },
  {
    from: `${ARTIFACTS_PATH}/BondingCurveToken.sol/BondingCurveToken.json`,
    to: `${ABIS_EXPORT_PATH}/BondingCurveToken.ts`,
    exportName: "BondingCurveTokenABI",
  },
];

// Ensure export directory exists
if (!fs.existsSync(ABIS_EXPORT_PATH)) {
  fs.mkdirSync(ABIS_EXPORT_PATH, { recursive: true });
}

contractABI.forEach((contract) => {
  // Read the JSON file
  const data = fs.readFileSync(contract.from, "utf8");

  // Parse the JSON data
  const jsonData = JSON.parse(data);

  // Extract the ABI
  const abi = jsonData.abi;

  // Create the TypeScript content
  const tsContent = `export const ${contract.exportName} = ${JSON.stringify(abi, null, 2)} as const;\n`;

  // Write the TypeScript file
  fs.writeFileSync(contract.to, tsContent, "utf8");
  console.log(`${contract.exportName} exported to ${contract.to}`);
});

console.log("\nABI export complete!");
