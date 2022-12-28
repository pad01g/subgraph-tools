require("dotenv").config();
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"

const main = async () => {
    // get collateral auction timestamp list
    const vaultHistoryJsonString = readFileSync("./data/jsons/vaultHistory.json").toString("utf-8")
    const vaultHistory = JSON.parse(vaultHistoryJsonString)
    const vaultIds = Object.keys(vaultHistory)
    const liquidationTimestampListByVault: { [key: string]: number[] } = {}
    for (const { vaultId, index } of vaultIds.map((vaultId, index) => ({ vaultId, index }))) {
        console.log(`index: ${index}, vaultId: ${vaultId}`)
        const timestampList = vaultHistory[vaultId].vaults[0].logs
            .filter(
                (log: any) => log.__typename.liquidationStartLog
            ).map(
                (log: any) => log.timestamp
            )
        liquidationTimestampListByVault[vaultId] = timestampList
    }

    // get vault set list
    const allVaultsAtBlock: { [key: string]: any } = {}
    const directoryList = readdirSync("./data/vaultSet", { withFileTypes: true }).map(item => item.name)
    for (const { directory, index } of directoryList.map((directory, index) => ({ directory, index }))) {
        console.log(`index: ${index}, directory: ${directory}`)
        const files = readdirSync(`./data/vaultSet/${directory}`, { withFileTypes: true })
            .filter(item => !item.isDirectory())
            .map(item => item.name)
        if (files.length) {
            const fileName = files[0]
            const allVaultsAtBlockJsonString = readFileSync(`./data/vaultSet/${directory}/${fileName}`).toString("utf-8")
            allVaultsAtBlock[directory] = JSON.parse(allVaultsAtBlockJsonString)
        }
        // if (Object.keys(allVaultsAtBlock).length > 10) { break; } // debug
    }

    // create data set
    const blocks = Object.keys(allVaultsAtBlock)
    const blockCount = blocks.length
    console.log(`blockCount: ${blockCount}`)
    const dataSet: { firstBlock: string, secondBlock: string, vaultsAtFirstBlock: any, vaultsAtSecondBlock: any }[] = []
    for (const { firstBlock, index } of blocks.map((firstBlock, index) => ({ firstBlock, index }))) {
        console.log(`index: ${index}, directory: ${firstBlock}`)
        const vaultsAtFirstBlock = allVaultsAtBlock[firstBlock]
        for (const secondBlock of blocks) {
            if (+secondBlock > +firstBlock) {
                const vaultsAtSecondBlock = allVaultsAtBlock[secondBlock]
                dataSet.push({ firstBlock, secondBlock, vaultsAtFirstBlock, vaultsAtSecondBlock })
            }
        }
        // if (dataSet.length > 10) { break; } // debug
    }

    type VaultTransitionType = { [key: string]: { firstBlock: string, secondBlock: string, first: any, second: any, liquidated: boolean, liquidationTimestamp: number | undefined } }

    // check if dataSet can be considered valid using liquidationTimestampListByVault
    // vaultTransitionSet array contents can be occasionally saved to file.
    const vaultTransitionSet: VaultTransitionType[] = []
    for (const { row, index } of dataSet.map((row, index) => ({ row, index }))) {
        console.log(`index: ${index}, row.firstBlock: ${row.firstBlock}, row.secondBlock: ${row.secondBlock}, ` +
            `row.vaultsAtFirstBlock["ETH-A"].timestamp: ${row.vaultsAtFirstBlock["ETH-A"].timestamp}, row.vaultsAtSecondBlock["ETH-A"].timestamp: ${row.vaultsAtSecondBlock["ETH-A"].timestamp}, `
            // `row.vaultsAtFirstBlock.resultArray: ${row.vaultsAtFirstBlock["ETH-A"].resultArray}, row.vaultsAtSecondBlock.resultArray: ${row.vaultsAtSecondBlock["ETH-A"].resultArray}, `
            // `row: ${JSON.stringify(row).slice(0, 1000)}`
        )

        const firstBlock = row.firstBlock
        const firstTimestamp = row.vaultsAtFirstBlock["ETH-A"].timestamp
        const firstVaults = row.vaultsAtFirstBlock["ETH-A"].resultArray

        const secondBlock = row.secondBlock
        const secondTimestamp = row.vaultsAtSecondBlock["ETH-A"].timestamp
        const secondVaults = row.vaultsAtSecondBlock["ETH-A"].resultArray

        const vaultTransition: VaultTransitionType = {};

        for (const vault of firstVaults) {
            // we only consider the case where at least first vault is not liquidated or empty.
            if ((+vault.collateral) && (+vault.debt)) {

                const liquidationTimestampList = liquidationTimestampListByVault[vault.id]
                // if liquidationTimestampList includes timestamp between firstTimestamp and secondTimestamp,
                // then second vault should be considered liquidated.

                const liquidationTimestamp = liquidationTimestampList.find(liquidationTimestamp =>
                    (+firstTimestamp < +liquidationTimestamp && +secondTimestamp < +liquidationTimestamp))
                if (liquidationTimestamp) {
                    vaultTransition[vault.id] = {
                        firstBlock,
                        secondBlock,
                        first: vault,
                        // this find is unnecessary. optimize later
                        second: secondVaults.find((secondVault: any) => secondVault.id === vault.id),
                        liquidated: true,
                        liquidationTimestamp,
                    }
                } else {
                    vaultTransition[vault.id] = {
                        firstBlock,
                        secondBlock,
                        first: vault,
                        // this find is unnecessary. optimize later
                        second: secondVaults.find((secondVault: any) => secondVault.id === vault.id),
                        liquidated: false,
                        liquidationTimestamp: undefined,
                    }
                }
            }
        }

        // vaultTransition now includes data and answer set.
        vaultTransitionSet.push(vaultTransition)
    }

    // now vaultTransitionSet has all required data.
    console.log(`vaultTransitionSet.length: ${vaultTransitionSet.length}`)
}

main().catch((error) => console.error(error))