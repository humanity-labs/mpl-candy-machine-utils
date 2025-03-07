import fs from 'fs';
import {
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  BlockheightBasedTransactionConfirmationStrategy,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  PROGRAM_ID,
  CONFIG_ARRAY_START,
  CONFIG_LINE_SIZE,
  createInitializeCandyMachineInstruction,
  InitializeCandyMachineInstructionAccounts,
  InitializeCandyMachineInstructionArgs,
  createSetCssSettingsInstruction,
  SetCssSettingsInstructionAccounts,
  SetCssSettingsInstructionArgs,
  createSetLockupSettingsInstruction,
  SetLockupSettingsInstructionAccounts,
  createSetCollectionDuringMintInstruction,
  SetCollectionDuringMintInstructionAccounts,
  createSetCollectionInstruction,
  SetCollectionInstructionAccounts,
  createAddConfigLinesInstruction,
  AddConfigLinesInstructionAccounts,
  createUpdateAuthorityInstruction,
  UpdateAuthorityInstructionAccounts,
  createUpdateCandyMachineInstruction,
  UpdateCandyMachineInstructionAccounts,
  CandyMachineData,
  CollectionPDA,
  CollectionPDAArgs,
  cusper,
  Creator,
  EndSettings,
  HiddenSettings,
  GatekeeperConfig,
  findCcsSettingsId,
  findLockupSettingsId,
  LockupType,
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

const candyMachineAuthorityKeypair = loadKeypair();
const candyMachineKeypair = Keypair.generate();

// PHASE 0 SETTINGS
const cluster = 'mainnet';
const ITEMS_AVAILABLE = 3699;
const PRICE = 0;
const GOLIVE = new Date("2023-01-08 20:00:00 UTC");
const GATEKEEPER = new PublicKey("AAKVY6RzNP25DWtzFh6gvjoTT9EZhzkmgESm49pNR4cQ");
const gatekeeper: GatekeeperConfig = { gatekeeperNetwork: GATEKEEPER, expireOnUse: false };

// PHASE 1 SETTINGS
// const cluster = "mainnet";
// const ITEMS_AVAILABLE = 300;
// const PRICE = 2.5 * LAMPORTS_PER_SOL;
// const GOLIVE = new Date("2022-12-17 22:00:00 UTC");
// const gatekeeper = null;

// PHASE 1 SETTINGS DEVNET
// const cluster = "devnet";
// const ITEMS_AVAILABLE = 300;
// const PRICE = 2.5 * LAMPORTS_PER_SOL;
// const GOLIVE = new Date("2022-12-17 07:00:00 UTC");
// const gatekeeper = null;

const uuidFromConfigPubkey = (configAccount: PublicKey): string => {
  return configAccount.toBase58().slice(0, 6);
};

const calculateSize = (items): number => {
  const size =
    CONFIG_ARRAY_START +
    4 +
    items * CONFIG_LINE_SIZE +
    8 +
    2 * (Math.floor(items / 8) + 1);
  return size;
};

const createCandyMachine = async (): Promise<any> => {
  const connection = connectionFor(cluster);
  const uuid = uuidFromConfigPubkey(candyMachineKeypair.publicKey);

  const initIx = createInitializeCandyMachineInstruction(
    <InitializeCandyMachineInstructionAccounts>{
      candyMachine: candyMachineKeypair.publicKey,
      wallet: candyMachineAuthorityKeypair.publicKey,
      authority: candyMachineAuthorityKeypair.publicKey,
      payer: candyMachineAuthorityKeypair.publicKey,
    },
    <InitializeCandyMachineInstructionArgs>{
      data: <CandyMachineData>{
        uuid: uuid,
        price: new BN(PRICE),
        symbol: "BB",
        sellerFeeBasisPoints: 999,
        maxSupply: new BN(ITEMS_AVAILABLE),
        isMutable: true,
        retainAuthority: true,
        goLiveDate: new BN(GOLIVE.getTime() / 1000),
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
        gatekeeper: gatekeeper,
      },
    }
  );

  console.debug(`> Adding ccs settings..`);
  const rulesetName = 'DEFAULT_RULESET';
  const rulesetId = findRulesetId(rulesetName);
  const [ccsSettingsId] = await findCcsSettingsId(
    candyMachineKeypair.publicKey
  );
  const ccsInitIx = createSetCssSettingsInstruction(
    <SetCssSettingsInstructionAccounts>{
      candyMachine: candyMachineKeypair.publicKey,
      authority: candyMachineAuthorityKeypair.publicKey,
      ccsSettings: ccsSettingsId,
      payer: candyMachineAuthorityKeypair.publicKey,
    },
    <SetCssSettingsInstructionArgs>{
      creator: candyMachineAuthorityKeypair.publicKey,
      ruleset: rulesetId,
    }
  );

  const tx = new Transaction();
  const size = calculateSize(ITEMS_AVAILABLE);
  const rent_exempt_lamports = await connection.getMinimumBalanceForRentExemption(size)
  .catch(e => console.warn(e));
  if (!rent_exempt_lamports) return createCandyMachine();
  
  const latest = await connection.getLatestBlockhashAndContext()
  .catch(e => console.warn(e));
  if (!latest) return createCandyMachine();

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

  console.debug(``);
  console.debug(`Sending & broadcasting create candymachine txn..`);
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
    else if (err.logs) {
      const resolved = cusper.errorFromProgramLogs(err.logs);
      console.error(`[resolved-error]`, {
        name: resolved?.name,
        code: resolved?.code,
        message: resolved?.message,
        stack: resolved?.stack,
      });
      return Promise.reject(err);
    }
    else {
      console.error(`[error]`, err);
      return Promise.reject(err);
    }
  });
};

createCandyMachine();
