require("dotenv").config();
import { readFileSync, readdirSync, writeFileSync } from "fs"

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
                (log: any) => log.__typename === "liquidationStartLog"
            ).map(
                (log: any) => log.timestamp
            )
        liquidationTimestampListByVault[vaultId] = timestampList
    }
    // console.log(JSON.stringify(liquidationTimestampListByVault))

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
        // if (Object.keys(allVaultsAtBlock).length > 100) { break; } // debug
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

    type VaultTransitionType = {
        [key: string]: {
            first: any,
            second: any,
            liquidated: boolean,
            liquidationTimestamp: number | undefined,

        }
    }
    type BlockDiffMetadata = {
        firstBlock: string,
        firstTimestamp: string,
        firstPrice: string,
        firstRate: string,
        firstLiquidationRatio: string,

        secondBlock: string,
        secondTimestamp: string,
        secondPrice: string,
        secondRate: string,
        secondLiquidationRatio: string,
    }
    type VaultTransitionWithMetadata = {
        meta: BlockDiffMetadata,
        vaultTransition: VaultTransitionType
    }
    type VaultTransitionSetType = VaultTransitionWithMetadata[]

    // check if dataSet can be considered valid using liquidationTimestampListByVault
    // vaultTransitionSet array contents can be occasionally saved to file.
    let vaultTransitionSet: VaultTransitionSetType = []
    const splitFileCount = 100;
    for (const { row, index } of dataSet.map((row, index) => ({ row, index }))) {
        // console.log(`index: ${index}, row.firstBlock: ${row.firstBlock}, row.secondBlock: ${row.secondBlock}, ` +
        //     `row.vaultsAtFirstBlock["ETH-A"].timestamp: ${row.vaultsAtFirstBlock["ETH-A"].timestamp}, row.vaultsAtSecondBlock["ETH-A"].timestamp: ${row.vaultsAtSecondBlock["ETH-A"].timestamp}, `
        //     // `row.vaultsAtFirstBlock.resultArray: ${row.vaultsAtFirstBlock["ETH-A"].resultArray}, row.vaultsAtSecondBlock.resultArray: ${row.vaultsAtSecondBlock["ETH-A"].resultArray}, `
        //     // `row: ${JSON.stringify(row).slice(0, 1000)}`
        // )

        const firstBlock = row.firstBlock
        const firstTimestamp = row.vaultsAtFirstBlock["ETH-A"].timestamp
        const firstVaults = row.vaultsAtFirstBlock["ETH-A"].resultArray
        const firstPrice = row.vaultsAtFirstBlock["ETH-A"].price
        const firstRate = row.vaultsAtFirstBlock["ETH-A"].rate
        const firstLiquidationRatio = row.vaultsAtFirstBlock["ETH-A"].liquidationRatio

        const secondBlock = row.secondBlock
        const secondTimestamp = row.vaultsAtSecondBlock["ETH-A"].timestamp
        const secondVaults = row.vaultsAtSecondBlock["ETH-A"].resultArray
        const secondPrice = row.vaultsAtSecondBlock["ETH-A"].price
        const secondRate = row.vaultsAtSecondBlock["ETH-A"].rate
        const secondLiquidationRatio = row.vaultsAtSecondBlock["ETH-A"].liquidationRatio

        const blockDiffMetadata: BlockDiffMetadata = {
            firstBlock, firstPrice, firstRate, firstLiquidationRatio, firstTimestamp,
            secondBlock, secondPrice, secondRate, secondLiquidationRatio, secondTimestamp,
        }
        const vaultTransition: VaultTransitionType = {};

        // optimize index for later lookup in for loop
        const secondvaultsById: { [key: string]: any } = {}
        secondVaults.map((value: any): void => {
            secondvaultsById[value.id] = value
        })

        for (const vault of firstVaults) {
            // we only consider the case where at least first vault is not liquidated or empty.
            if ((+vault.collateral) && (+vault.debt)) {

                const liquidationTimestampList = liquidationTimestampListByVault[vault.id]
                // if liquidationTimestampList includes timestamp between firstTimestamp and secondTimestamp,
                // then second vault should be considered liquidated.

                const liquidationTimestamp = liquidationTimestampList.find(liquidationTimestamp =>
                    (+firstTimestamp < +liquidationTimestamp && +liquidationTimestamp < +secondTimestamp))
                if (liquidationTimestamp && liquidationTimestampList.length) {
                    // console.log(JSON.stringify({ firstTimestamp, secondTimestamp, liquidationTimestamp, liquidationTimestampList }))
                }
                if (liquidationTimestamp) {
                    vaultTransition[vault.id] = {
                        first: vault,
                        second: secondvaultsById[vault.id],
                        liquidated: true,
                        liquidationTimestamp,
                    }
                } else {
                    vaultTransition[vault.id] = {
                        first: vault,
                        second: secondvaultsById[vault.id],
                        liquidated: false,
                        liquidationTimestamp: undefined,
                    }
                }
            }
        }

        const vaultTransitionWithMetadata: VaultTransitionWithMetadata = {
            meta: blockDiffMetadata,
            vaultTransition: vaultTransition,
        }

        // vaultTransitionWithMetadata now includes data and answer set.
        vaultTransitionSet.push(vaultTransitionWithMetadata)

        if (index % splitFileCount === splitFileCount - 1) {
            console.log(`save split content in file: ${index - (splitFileCount - 1)} ... ${index}`)
            // file is saved.
            writeFileSync(`./data/result/result-${index - (splitFileCount - 1)}-${index}.json`, JSON.stringify(vaultTransitionSet, null, 2))
            // then array is reset as empty array
            vaultTransitionSet = []
        }
    }

    // now vaultTransitionSet has all required data.
    console.log(`vaultTransitionSet.length: ${vaultTransitionSet.length}, `
        // `vaultTransitionSet: ${JSON.stringify(vaultTransitionSet, null, 2).slice(2000)}`
    )
}

main().catch((error) => console.error(error))