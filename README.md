# what is this?

fetch data from subgraph api for various analysis of vaults collateralization.

# setup

```
yarn install
```

.env file

```
API_ENDPOINT='https://api.studio.thegraph.com/query/XXXXX/XXXXXXXXXX/XXXXXX'
```

# example

```
yarn getAllVaultId
```

# usage

 - setup .env file
 - run `yarn getAllVaultId` to fetch all vault ids
 - run `yarn getVaultHistory` to fetch all vault operation logs of today
 - run `yarn getVaultSetHistory` to fetch all vault set at some block in the past
 - run `yarn convertJsonToCsv` to convert all fetched raw json data to useful data for analysis
 
 