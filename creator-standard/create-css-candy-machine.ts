import fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  BlockheightBasedTransactionConfirmationStrategy,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  CONFIG_ARRAY_START,
  CONFIG_LINE_SIZE,
  createInitializeCandyMachineInstruction,
  createSetCssSettingsInstruction,
  findCcsSettingsId,
  PROGRAM_ID,
} from "@cardinal/mpl-candy-machine-utils";
import { BN, utils } from "@project-serum/anchor";
import { findRulesetId } from "@cardinal/creator-standard";
import { connectionFor } from "../connection";

// for environment variables
require("dotenv").config();

const loadKeypair = () => {
  const path: string = process.env.LAUNCH_AUTHORITY_KEY || '';
  const secretKeyString = fs.readFileSync(path, { encoding: 'utf8' });
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
};

//const candyMachineAuthorityKeypair = Keypair.fromSecretKey(
//  utils.bytes.bs58.decode(process.env.WALLET_KEYPAIR || "")
//);
const candyMachineAuthorityKeypair = loadKeypair();
const candyMachineKeypair = Keypair.generate();
const cluster = "mainnet";
const ITEMS_AVAILABLE = 6500;

const uuidFromConfigPubkey = (configAccount: PublicKey) => {
  return configAccount.toBase58().slice(0, 6);
};

const createCandyMachine = async (): Promise<any> => {
  const connection = connectionFor(cluster);
  const uuid = uuidFromConfigPubkey(candyMachineKeypair.publicKey);
  const initIx = createInitializeCandyMachineInstruction(
    {
      candyMachine: candyMachineKeypair.publicKey,
      wallet: candyMachineAuthorityKeypair.publicKey,
      authority: candyMachineAuthorityKeypair.publicKey,
      payer: candyMachineAuthorityKeypair.publicKey,
    },
    {
      data: {
        uuid: uuid,
        price: new BN(0),
        symbol: "BB",
        sellerFeeBasisPoints: 999,
        maxSupply: new BN(ITEMS_AVAILABLE),
        isMutable: true,
        retainAuthority: true,
        goLiveDate: new BN(Date.now() / 1000),
        endSettings: null,
        creators: [
          {
            address: candyMachineKeypair.publicKey,
            verified: true,
            share: 0,
          },
          {
            address: candyMachineAuthorityKeypair.publicKey,
            verified: false,
            share: 100,
          },
        ],
        hiddenSettings: null,
        whitelistMintSettings: null,
        itemsAvailable: new BN(ITEMS_AVAILABLE),
        gatekeeper: null,
      },
    }
  );

  const [ccsSettingsId] = await findCcsSettingsId(
    candyMachineKeypair.publicKey
  );
  const rulesetId = findRulesetId();
  const ccsInitIx = createSetCssSettingsInstruction(
    {
      candyMachine: candyMachineKeypair.publicKey,
      authority: candyMachineAuthorityKeypair.publicKey,
      ccsSettings: ccsSettingsId,
      payer: candyMachineAuthorityKeypair.publicKey,
    },
    {
      creator: candyMachineAuthorityKeypair.publicKey,
      ruleset: rulesetId,
    }
  );

  const tx = new Transaction();
  const size =
    CONFIG_ARRAY_START +
    4 +
    ITEMS_AVAILABLE * CONFIG_LINE_SIZE +
    8 +
    2 * (Math.floor(ITEMS_AVAILABLE / 8) + 1);
  
  const rent_exempt_lamports = await connection.getMinimumBalanceForRentExemption(size);
  const latest = await connection.getLatestBlockhashAndContext();

  tx.instructions = [
    SystemProgram.createAccount({
      fromPubkey: candyMachineAuthorityKeypair.publicKey,
      newAccountPubkey: candyMachineKeypair.publicKey,
      space: size,
      lamports: rent_exempt_lamports,
      programId: PROGRAM_ID,
    }),
    initIx,
    ccsInitIx,
  ];

  tx.feePayer = candyMachineAuthorityKeypair.publicKey;
  tx.recentBlockhash = latest.value.blockhash;
  tx.sign(candyMachineAuthorityKeypair, candyMachineKeypair);

  const strategy: BlockheightBasedTransactionConfirmationStrategy = {
    signature: utils.bytes.bs58.encode(tx.signature as Buffer),
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
  };

  return await sendAndConfirmRawTransaction(
    connection,
    tx.serialize(),
    strategy,
  )
  .then(txid => {
    console.log(
      `Succesfully created candymachine`, {
        candymachine: candyMachineKeypair.publicKey.toBase58(),
        candymachineAccount: `https://explorer.solana.com/address/${candyMachineKeypair.publicKey.toBase58()}?cluster=${cluster}`,
        candymachineAuthority: candyMachineAuthorityKeypair.publicKey.toBase58(),
        ccsSettingsId: ccsSettingsId.toBase58(),
        rulesetId: rulesetId.toBase58(),
        uuid: uuid,
        cluster,
        txid,
        tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
      }
    );
    return Promise.resolve(txid);
  })
  .catch(err => {
    const e = err.toString().toLowerCase();
    if (e.indexOf('node is behind') > -1) {
      return createCandyMachine();
    }
    else if (e.indexOf('blockhash not found') > -1) {
      return createCandyMachine();
    }
    else {
      console.error(`[error]`, err);
      return Promise.reject(err);
    }
  });
};

createCandyMachine();
