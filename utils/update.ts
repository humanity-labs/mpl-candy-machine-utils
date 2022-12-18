import fs from "fs";
import {
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  CandyMachine,
  createUpdateCandyMachineInstruction,
  EndSettingType,
} from "@cardinal/mpl-candy-machine-utils";
import { BN, utils } from "@project-serum/anchor";
import { connectionFor } from "../connection";

// for environment variables
require("dotenv").config();

const loadKeypair = () => {
  const path: string = process.env.LAUNCH_AUTHORITY_KEY || '';
  const secretKeyString = fs.readFileSync(path, { encoding: 'utf8' });
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
};

const candyMachineAuthorityKeypair = loadKeypair();
let connection = connectionFor('mainnet');

const cluster = "mainnet";
// const candyMachineId = new PublicKey("BPbHupxWqjJxDQT9LaCo583R1JgMRqcHSfJLVzu7RdYn");
// const ITEMS_AVAILABLE = 3873;
const candyMachineId = new PublicKey("8WtmaAFjBEmAjfuBkjutcdYEDFogdH27CVFkVD257151");
const ITEMS_AVAILABLE = 2650;

const update = async (): Promise<any> => {
  console.debug(`> candyMachineId`, candyMachineId.toBase58());

  const candyMachine = await CandyMachine.fromAccountAddress(
    connection,
    candyMachineId,
  );

  const tx = new Transaction();
  tx.add(
    createUpdateCandyMachineInstruction({
      candyMachine: candyMachineId,
      authority: candyMachineAuthorityKeypair.publicKey,
      wallet: candyMachineAuthorityKeypair.publicKey,
    }, {
      data: {
        uuid: candyMachine.data.uuid,
        price: candyMachine.data.price,
        symbol: candyMachine.data.symbol,
        sellerFeeBasisPoints: candyMachine.data.sellerFeeBasisPoints,
        maxSupply: new BN(2650),
        isMutable: candyMachine.data.isMutable,
        retainAuthority: candyMachine.data.retainAuthority,
        goLiveDate: candyMachine.data.goLiveDate,
        endSettings: {
          endSettingType: EndSettingType.Amount,
          number: new BN(2650),
        },
        creators: candyMachine.data.creators,
        hiddenSettings: candyMachine.data.hiddenSettings,
        whitelistMintSettings: candyMachine.data.whitelistMintSettings,
        itemsAvailable: candyMachine.data.itemsAvailable,
        gatekeeper: candyMachine.data.gatekeeper,
      }
    })
  );

  tx.feePayer = candyMachineAuthorityKeypair.publicKey;
  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.sign(candyMachineAuthorityKeypair);
  
  console.debug(``);
  console.debug(`Sending & broadcasting update txn..`);
  return sendAndConfirmRawTransaction(connection, tx.serialize())
  .then(txid => {
    console.log(
      `Succesfully updated ${candyMachineId.toString()}`, {
        candyMachine: candyMachineId.toBase58(),
        tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
      }
    );
    return Promise.resolve();
  })
  .catch(err => {
    const e = err.toString().toLowerCase();
    if (e.indexOf('node is behind') > -1) {
      connection = connectionFor(cluster);
      return update();
    }
    else if (e.indexOf('blockhash not found') > -1) {
      connection = connectionFor(cluster);
      return update();
    }
    else {
      console.error(`[error]`, err);
      return Promise.reject(err);
    }
  });
};

update();
