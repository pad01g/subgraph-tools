import { GraphQLClient, gql } from 'graphql-request'
require("dotenv").config();
import { writeFileSync, mkdirSync } from "fs"

// get all vaults with safety level parameter at some block number
const getAllVaults = async (subgraphClient: GraphQLClient, blockNumber: number) => {
  try {
    const vaultTypes = ['ETH-A']
    const vaultTypesResultMap = vaultTypes.map(async (vaultType) => {
      const collateralTypeVaultCount = await subgraphClient.request(gql`{
        collateralType(id: "${vaultType}", block: {number: ${blockNumber}}) {
          vaultCount
        }
        vaults(where: { collateralType: "${vaultType}", collateral_not: 0, debt_not: 0 }, first: 1, orderBy: id, orderDirection: desc, block: {number: ${blockNumber}}){
          id
        }
        systemStates(block: {number: ${blockNumber}}, first: 1){
          timestamp
        }
      }`);
      let vaultCount = 0;
      let maxId = 0;
      let timestamp = 0;
      Object.entries(collateralTypeVaultCount).forEach((responseObject) => {
        const key: string = responseObject[0]
        const value: any = responseObject[1]
        if (key && value) {
          if (key === 'collateralType') {
            vaultCount = value.vaultCount;
          } else if (key === 'vaults') {
            maxId = value[0] ? value[0].id : 0;
          } else if (key === "systemStates") {
            timestamp = value[0] ? value[0].timestamp : 0;
          }
        }
      });

      let currentId = 0;
      let resultArray: any[] = [];
      while (maxId && vaultCount > resultArray.length) {
        console.log(`resultArray.length: ${resultArray.length}, maxId: ${maxId}, currentId: ${currentId}, vaultCount: ${vaultCount}`)
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
        if (!vaultsIds.length) {
          break;
        }
        currentId = vaultsIds[vaultsIds.length - 1];
        resultArray = [...resultArray, ...vaultsSubgraphClientResult.vaults];
      }
      const uniqueArray: any[] = []
      const uniqueIndexList: string[] = []
      resultArray.map(vault => {
        if (uniqueIndexList.includes(vault.id)) {
          uniqueArray.push(vault)
          uniqueIndexList.push(vault.id)
        }
      })
      return { timestamp, resultArray: uniqueArray };
    });
    let object: { [key: string]: any } = {};
    (await Promise.all(vaultTypesResultMap)).map((obj, index) => {
      const key = vaultTypes[index];
      object[key] = obj;
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

    // const blockMin = 8928198
    const blockMin = 15412270 // 7338 + 14783922
    // get current block
    const blockMax = 16267142
    // const blockDataPointCount = 5
    const blockDataPointCount = 10
    const blockDiff = Math.floor((blockMax - blockMin) / blockDataPointCount)

    for (let blockDataPoint = blockMin; blockDataPoint < blockMax; blockDataPoint += blockDiff) {
      const allVaults = await getAllVaults(graphQLClient, blockDataPoint)
      console.log(`blockDataPoint: ${blockDataPoint},  allVaults["ETH-A"].timestamp: ${allVaults ? allVaults["ETH-A"].timestamp : undefined}, allVaults["ETH-A"].resultArray.length: ${(allVaults ? allVaults["ETH-A"].resultArray.length : undefined)}, count: ${Math.floor((blockDataPoint - blockMin) / blockDiff)} `)
      mkdirSync(`./data/vaultSet/${blockDataPoint}/`)
      writeFileSync(`./data/vaultSet/${blockDataPoint}/allVaultsByBlock-max-${blockMax}-split-${blockDataPointCount}.json`, JSON.stringify(allVaults, null, 2))
    }
  }
}

main().catch((error) => console.error(error))