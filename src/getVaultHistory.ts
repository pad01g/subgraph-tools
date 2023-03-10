import { GraphQLClient, gql } from 'graphql-request'
require("dotenv").config();
import { writeFileSync, readFileSync } from "fs"

// get tx log and property of specific vault
const getSingleVault = async (subgraphClient: GraphQLClient, cdpIdStr: string) => {
    let fetchResult;
    // get vault information and logs specified by search condition.
    const logsQuery = (searchCondition: string) => `
      vaults(first: 1, where: ${searchCondition}) {
        id,
        cdpId,
        openedAt,
        updatedAt,
        collateral,
        debt,
        collateralType{
          id,
          rate,
        },
        logs(orderBy: timestamp, orderDirection: desc, first: 1000) {
          __typename,
          transaction,
          timestamp,
          ... on VaultCreationLog {
            id,
          },
          ... on VaultCollateralChangeLog {
            id,
            collateralDiff,
            collateralAfter,
            collateralBefore,
          }
          ... on VaultDebtChangeLog {
            id,
            debtDiff,
            debtAfter,
            debtBefore
          },
          ... on VaultTransferChangeLog {
            id,
            previousOwner{id},
            nextOwner{id},
          },
          ...on VaultSplitChangeLog {
            id,
            dst,
            src,
            collateralToMove,
            debtToMove,
          },
        }
      }
    `;
    // get auctions specified by vault id
    const auctionsQuery = (vaultId: string) => `
      saleAuctions(where: {vault: "${vaultId}"}){
        id,
        vault{
          id
        },
        amountDaiToRaise,
        amountCollateralToSell,
        boughtAt,
        isActive,
        startedAt,
        resetedAt,
        updatedAt
      }
    `;
    // get split change logs where address is destination.
    const vaultSplitChangeLogsDestinationAddressQuery = (destionationAddress: string) => `
      vaultSplitChangeLogs(where: {dst: "${destionationAddress}"}){
        __typename,
        id,
        dst,
        src,
        collateralToMove,
        debtToMove,
        transaction,
        timestamp,
        block,
      }
    `;
    // cdpId is specified by number
    if (cdpIdStr.match(/^[0-9]+$/)) {
        try {
            const vaultByCdpId = await subgraphClient.request(gql`{
          ${logsQuery(`{cdpId: ${cdpIdStr}}`)}
        }`);

            let saleAuctionsAndVaultSplitChangeLogsDestinationAddressQueryResult;
            if (vaultByCdpId && vaultByCdpId.vaults[0] && vaultByCdpId.vaults[0].id) {
                const [destinationAddress, _destinationIlk] = vaultByCdpId.vaults[0].id.split('-');
                saleAuctionsAndVaultSplitChangeLogsDestinationAddressQueryResult = await subgraphClient.request(gql`{
            ${auctionsQuery(vaultByCdpId.vaults[0].id)}
            ${vaultSplitChangeLogsDestinationAddressQuery(destinationAddress)}
          }`);
            }

            if (vaultByCdpId && saleAuctionsAndVaultSplitChangeLogsDestinationAddressQueryResult) {
                fetchResult = vaultByCdpId;
                fetchResult.saleAuctions = saleAuctionsAndVaultSplitChangeLogsDestinationAddressQueryResult.saleAuctions;
                fetchResult.vaultSplitChangeLogs =
                    saleAuctionsAndVaultSplitChangeLogsDestinationAddressQueryResult.vaultSplitChangeLogs;
            }
        } catch (err) {
            console.log('Vault could not be retrieved by CdpId. Retrying with vaultId...');
        }
    }
    // could not get by cdpId number, use id string `address`-`ilk` format.
    if (!fetchResult) {
        const [destinationAddress, _destinationIlk] = cdpIdStr.split('-');
        try {
            const vaultById = await subgraphClient.request(gql`{
          ${logsQuery(`{id: "${cdpIdStr}"}`)}
          ${auctionsQuery(cdpIdStr)}
          ${vaultSplitChangeLogsDestinationAddressQuery(destinationAddress)}
        }`);
            if (vaultById) {
                fetchResult = vaultById;
            }
        } catch (err) {
            console.log('Vault could not be retrieved by id');
        }
    }
    if (!fetchResult) {
        console.error('Vault could not be retrieved');
        fetchResult = undefined;
    } else {
        const fetchedVault = fetchResult.vaults[0];
        if (fetchedVault && fetchedVault.logs) {
            const collateralType = fetchedVault.collateralType;
            const vaultId = fetchedVault.id;
            const vaultLogs = fetchedVault.logs.concat().map((log: any) => Object.assign({}, log));

            // merge logs from vault split change logs, where it could have destination address
            const vaultLogsWithVaultSplitChangeLogsDestination = vaultLogs.concat(fetchResult.vaultSplitChangeLogs);

            // logs are ordered from new to old, change it as from old to new
            const reversedLogs = vaultLogsWithVaultSplitChangeLogsDestination.sort((left: any, right: any) => {
                const timestampDiff = parseInt(left.timestamp) - parseInt(right.timestamp);
                if (timestampDiff) {
                    return timestampDiff;
                } else {
                    const [_leftTxHash, leftLogIndex, leftSuffix] = left.id.split('-');
                    const [_rightTxHash, rightLogIndex, rightSuffix] = right.id.split('-');
                    const logIndexDiff = parseInt(leftLogIndex) - parseInt(rightLogIndex);
                    if (logIndexDiff) {
                        return logIndexDiff;
                    } else {
                        return parseInt(leftSuffix) - parseInt(rightSuffix);
                    }
                }
            });

            // some auctions exist for vault, let's merge auction logs to vault change logs
            let auctionLogs = [];
            if (fetchResult.saleAuctions[0] && fetchResult.saleAuctions[0].startedAt) {
                auctionLogs = fetchResult.saleAuctions
                    .map((saleAuction: any) => {
                        const resultArray = [];
                        if (saleAuction.startedAt && parseInt(saleAuction.startedAt)) {
                            resultArray.push({
                                ...saleAuction,
                                id: `liquidationStartLog-${saleAuction.id}`,
                                timestamp: saleAuction.startedAt,
                                __typename: `liquidationStartLog`,
                            });
                        }
                        if (saleAuction.boughtAt && parseInt(saleAuction.boughtAt)) {
                            resultArray.push({
                                ...saleAuction,
                                id: `liquidationFinishLog-${saleAuction.id}`,
                                timestamp: saleAuction.boughtAt,
                                __typename: `liquidationFinishLog`,
                            });
                        }
                        return resultArray;
                    })
                    .flat();
            }
            const vaultWithAuctionLogs = reversedLogs
                .concat(auctionLogs)
                .sort((left: any, right: any) => left.timestamp - right.timestamp);

            // logs have collateral/debt change in different format.
            // calculate before/after/change value.
            const modifiedLogs = vaultWithAuctionLogs.map((log: any, mapIndex: number) => {
                // Collateral Change ()
                const updateCollateralChange = (log: any, index: any) => {
                    let collateralChange = 0;
                    let collateralBefore = undefined;
                    let collateralAfter = undefined;
                    if (log.__typename === 'VaultCollateralChangeLog') {
                        collateralChange = parseFloat(log.collateralDiff);
                        collateralBefore = parseFloat(log.collateralBefore);
                        collateralAfter = parseFloat(log.collateralAfter);
                    } else if (log.__typename === 'VaultSplitChangeLog') {
                        if (vaultId && vaultId.includes(log.src)) {
                            collateralChange = -parseFloat(log.collateralToMove);
                        } else if (vaultId && vaultId.includes(log.dst)) {
                            collateralChange = parseFloat(log.collateralToMove);
                        }
                    } else if (log.__typename === 'VaultTransferChangeLog') {
                        if (vaultId && vaultId.includes(log.previousOwner)) {
                            collateralChange = -0;
                        } else if (vaultId && vaultId.includes(log.nextOwner)) {
                            collateralChange = 0;
                        }
                    } else if (index !== 0 && index > 1) {
                        const previousLog = vaultWithAuctionLogs[index - 1];
                        collateralChange = parseFloat(log.collateral) - parseFloat(previousLog.collateral);
                        if (Number.isNaN(collateralChange)) {
                            collateralChange = 0;
                        }
                    }
                    log.collateralBefore = collateralBefore;
                    log.collateralAfter = collateralAfter;
                    log.collateralChange = collateralChange;
                    return log;
                };
                const logUpdatedCollateralChange = updateCollateralChange(log, mapIndex);

                // Debt Change (DAI)
                const updateDebtChange = (log: any, index: any) => {
                    let debtChange = 0;
                    let debtBefore = undefined;
                    let debtAfter = undefined;
                    if (log.__typename === 'VaultDebtChangeLog') {
                        debtChange = parseFloat(log.debtDiff);
                        debtBefore = parseFloat(log.debtBefore);
                        debtAfter = parseFloat(log.debtAfter);
                    } else if (log.__typename === 'VaultSplitChangeLog') {
                        if (vaultId && vaultId.includes(log.src)) {
                            debtChange = -parseFloat(log.debtToMove);
                        } else if (vaultId && vaultId.includes(log.dst)) {
                            debtChange = parseFloat(log.debtToMove);
                        }
                    } else if (log.__typename === 'VaultTransferChangeLog') {
                        if (vaultId && vaultId.includes(log.previousOwner)) {
                            debtChange = -0;
                        } else if (vaultId && vaultId.includes(log.nextOwner)) {
                            debtChange = 0;
                        }
                    } else if (index !== 0 && index > 1) {
                        const previousLog = vaultWithAuctionLogs[index - 1];
                        debtChange = parseFloat(log.debt) - parseFloat(previousLog.debt);
                        if (Number.isNaN(debtChange)) {
                            debtChange = 0;
                        }
                    }
                    log.debtBefore = debtBefore;
                    log.debtAfter = debtAfter;
                    log.debtChange = debtChange;
                    return log;
                };
                const logUpdatedDebtChange = updateDebtChange(logUpdatedCollateralChange, mapIndex);
                return logUpdatedDebtChange;
            });

            // update all log records for view
            for (let logIndex = 0; logIndex < modifiedLogs.length; logIndex++) {

                // update all the log records so that they all have price/diff/before/after value.
                if (logIndex === 0) {
                    vaultWithAuctionLogs[logIndex].debtBefore = 0;
                    vaultWithAuctionLogs[logIndex].collateralBefore = 0;
                    vaultWithAuctionLogs[logIndex].debtAfter = 0;
                    vaultWithAuctionLogs[logIndex].collateralAfter = 0;
                    vaultWithAuctionLogs[logIndex].preCollateralizationRatio = 0;
                    vaultWithAuctionLogs[logIndex].postCollateralizationRatio = 0;
                } else {
                    // debtBefore
                    if (!vaultWithAuctionLogs[logIndex].debtBefore) {
                        vaultWithAuctionLogs[logIndex].debtBefore = vaultWithAuctionLogs[logIndex - 1].debtAfter;
                    }

                    // debtAfter
                    if (vaultWithAuctionLogs[logIndex].__typename === 'liquidationFinishLog') {
                        vaultWithAuctionLogs[logIndex].debtAfter = 0;
                        vaultWithAuctionLogs[logIndex].debtChange = -vaultWithAuctionLogs[logIndex].debtBefore;
                    } else {
                        if (!vaultWithAuctionLogs[logIndex].debtAfter) {
                            if (!vaultWithAuctionLogs[logIndex].debtChange) {
                                vaultWithAuctionLogs[logIndex].debtAfter = vaultWithAuctionLogs[logIndex].debtBefore;
                            } else {
                                vaultWithAuctionLogs[logIndex].debtAfter =
                                    vaultWithAuctionLogs[logIndex - 1].debtAfter + vaultWithAuctionLogs[logIndex].debtChange;
                            }
                        }
                    }

                    // collateralBefore
                    if (!vaultWithAuctionLogs[logIndex].collateralBefore) {
                        vaultWithAuctionLogs[logIndex].collateralBefore = vaultWithAuctionLogs[logIndex - 1].collateralAfter;
                    }

                    // collateralAfter
                    if (vaultWithAuctionLogs[logIndex].__typename === 'liquidationFinishLog') {
                        vaultWithAuctionLogs[logIndex].collateralAfter = 0;
                        vaultWithAuctionLogs[logIndex].collateralChange = -vaultWithAuctionLogs[logIndex].collateralBefore;
                    } else {
                        if (!vaultWithAuctionLogs[logIndex].collateralAfter) {
                            if (!vaultWithAuctionLogs[logIndex].collateralChange) {
                                vaultWithAuctionLogs[logIndex].collateralAfter = vaultWithAuctionLogs[logIndex].collateralBefore;
                            } else {
                                vaultWithAuctionLogs[logIndex].collateralAfter =
                                    vaultWithAuctionLogs[logIndex - 1].collateralAfter + vaultWithAuctionLogs[logIndex].collateralChange;
                            }
                        }
                    }
                }
            }

            // reverse it again to view as from new to old
            fetchResult.vaults[0].logs = modifiedLogs.reverse().map((log: any) => Object.assign({}, log));
        }
    }
    return fetchResult;
};

const main = async () => {
    const endpoint = process.env.API_ENDPOINT
    if (endpoint) {
        const graphQLClient = new GraphQLClient(endpoint, { mode: 'cors' })

        const allVaultIdFilePath = `./data/allVaultId.json`
        const allVaultId = readFileSync(allVaultIdFilePath).toString("utf8");
        const cdpIdList: string[] = JSON.parse(allVaultId).map((v: any) => v.id)
        // const cdpIdList = ["0x0105049810a15d3fc0636d9bc85d14a707515e75-ETH-A"];

        let allVaultsById: { [key: string]: any } = {}
        for (const { index, value } of cdpIdList.map((value, index) => ({ index, value }))) {
            const singleVault = await getSingleVault(graphQLClient, value)
            allVaultsById[value] = singleVault
            console.log(`index: ${index}, value: ${value}, logs.length: ${singleVault.vaults[0].logs.length}`)
        }
        writeFileSync(`./data/vaultHistory.json`, JSON.stringify(allVaultsById, null, 2))
    }
}

main().catch((error) => console.error(error))