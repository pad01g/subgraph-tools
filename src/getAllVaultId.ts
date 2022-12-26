import { GraphQLClient, gql } from 'graphql-request'
require("dotenv").config();
import { writeFileSync } from "fs"

// just get all vault ids
const getAllVaults = async (subgraphClient: GraphQLClient) => {
  try {
    let currentId = 0;
    let resultArray: any[] = [];
    while (true) {
      const vaultsSubgraphClientResult = await subgraphClient.request(gql`{
          vaults(where: { id_gt: "${currentId}" }, first: 1000, orderBy: id, orderDirection: asc){
            id,
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
  } catch (err) {
    console.error('All vaults could not be obtained due to an error.', err);
  }

  return null;
};

const main = async () => {
  const endpoint = process.env.API_ENDPOINT
  if (endpoint) {
    const graphQLClient = new GraphQLClient(endpoint, { mode: 'cors' })
    const allVaults = await getAllVaults(graphQLClient)
    writeFileSync(`./data/allVaultId.json`, JSON.stringify(allVaults, null, 2))
  }
}

main().catch((error) => console.error(error))