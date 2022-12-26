import { GraphQLClient, gql } from 'graphql-request'
require("dotenv").config();
import { writeFileSync } from "fs"

const getAllVaults = async (subgraphClient: GraphQLClient, blockNumber: number) => {
  try {
    const vaultTypes = ['ETH-A']
    const vaultTypesResultMap = vaultTypes.map(async (vaultType) => {
      const collateralTypeVaultCount = await subgraphClient.request(gql`{
        collateralType(id: "${vaultType}") {
          vaultCount
        }
        vaults(where: { collateralType: "${vaultType}", collateral_not: 0, debt_not: 0 }, first: 1, orderBy: id, orderDirection: desc){
          id
        }
      }`);
      let vaultCount = 0;
      let maxId = 0;
      Object.entries(collateralTypeVaultCount).forEach((responseObject) => {
        const key: string = responseObject[0]
        const value: any = responseObject[1]
        if (key && value) {
          if (key === 'collateralType') {
            vaultCount = value.vaultCount;
          } else if (key === 'vaults') {
            maxId = value[0] ? value[0].id : 0;
          }
        }
      });

      let currentId = 0;
      let resultArray: any[] = [];
      while (maxId && vaultCount > resultArray.length) {
        const vaultsSubgraphClientResult = await subgraphClient.request(gql`{
          vaults(where: { collateralType: "${vaultType}", id_gt: "${currentId}" }, first: 1000, orderBy: id, orderDirection: asc, block: {number: ${blockNumber}}){
            id,
            collateral,
            debt,
            cdpId,
            owner
            updatedAt,
            updatedAtBlock,
            updatedAtTransaction,
            safetyLevel,
          }
        }`);
        const vaultsIds = vaultsSubgraphClientResult.vaults.map((v: any) => v.id).sort();
        currentId = vaultsIds[vaultsIds.length - 1];
        resultArray = [...resultArray, ...vaultsSubgraphClientResult.vaults];
        if (!vaultsSubgraphClientResult.vaults.length) {
          break;
        }
      }
      return resultArray;
    });
    let object: { [key: string]: any } = {};
    (await Promise.all(vaultTypesResultMap)).map((array, index) => {
      const key = vaultTypes[index];
      object[key] = array;
    });
    return object;
  } catch (err) {
    console.error('All vaults could not be obtained due to an error.', err);
  }

  return null;
};

const main = async () => {
  const endpoint = process.env.API_ENDPOINT
  if (endpoint) {
    const graphQLClient = new GraphQLClient(endpoint, { mode: 'cors' })

    const blockMin = 8928198
    // get current block
    const blockMax = 16267142
    const blockDataPointCount = 5
    // const blockDataPointCount = 1000
    const blockDiff = Math.floor((blockMax - blockMin) / blockDataPointCount)

    let allVaultsByBlock: { [key: number]: any } = {}
    for (let blockDataPoint = blockMin; blockDataPoint < blockMax; blockDataPoint += blockDiff) {
      const allVaults = await getAllVaults(graphQLClient, blockDataPoint)
      allVaultsByBlock[blockDataPoint] = allVaults
      console.log(`blockDataPoint: ${blockDataPoint}, allVaults.length: ${(allVaults ? allVaults["ETH-A"].length : undefined)}, count: ${Math.floor((blockDataPoint - blockMin) / blockDiff)} `)
    }
    writeFileSync(`./data/allVaultsByBlock-max-${blockMax}-split-${blockDataPointCount}.json`, JSON.stringify(allVaultsByBlock, null, 2))
  }
}

main().catch((error) => console.error(error))