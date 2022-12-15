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
import {
  findAta,
  withFindOrInitAssociatedTokenAccount,
} from "@cardinal/token-manager";
import { findRulesetId } from "@cardinal/creator-standard";
import { connectionFor } from "../connection";

// for environment variables
require("dotenv").config();

const path: string = process.env.WALLET_KEYPAIR || '';
const secretKeyString = fs.readFileSync(path, { encoding: 'utf8' })
const secretKey = Uint8Array.from(JSON.parse(secretKeyString))
const candyMachineAuthorityKeypair = Keypair.fromSecretKey(secretKey)

//const candyMachineAuthorityKeypair = Keypair.fromSecretKey(
//  utils.bytes.bs58.decode(process.env.WALLET_KEYPAIR || "")
//);
const PAYMENT_MINT = new PublicKey(
  "tttvgrrNcjVZJS33UAcwTNs46pAidgsAgJqGfYGdZtG"
);
const cluster = "devnet";
const connection = connectionFor(cluster);
const candyMachineKeypair = Keypair.generate();
const ITEMS_AVAILABLE = 10;

const uuidFromConfigPubkey = (configAccount: PublicKey) => {
  return configAccount.toBase58().slice(0, 6);
};

const createCandyMachine = async () => {
  const uuid = uuidFromConfigPubkey(candyMachineKeypair.publicKey);

  const candyMachineWalletId = await findAta(
    PAYMENT_MINT,
    candyMachineKeypair.publicKey,
    true
  );
  const initIx = createInitializeCandyMachineInstruction(
    {
      candyMachine: candyMachineKeypair.publicKey,
      wallet: candyMachineWalletId,
      authority: candyMachineAuthorityKeypair.publicKey,
      payer: candyMachineAuthorityKeypair.publicKey,
    },
    {
      data: {
        uuid: uuid,
        price: new BN(1),
        symbol: "BB",
        sellerFeeBasisPoints: 999,
        maxSupply: new BN(2500),
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
  const rulesetId = findRulesetId();
  const [cssSettingsId] = await findCcsSettingsId(
    candyMachineKeypair.publicKey
  );
  const cssInitIx = createSetCssSettingsInstruction(
    {
      candyMachine: candyMachineKeypair.publicKey,
      authority: candyMachineAuthorityKeypair.publicKey,
      ccsSettings: cssSettingsId,
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

  await withFindOrInitAssociatedTokenAccount(
    tx,
    connection,
    PAYMENT_MINT,
    candyMachineKeypair.publicKey,
    candyMachineAuthorityKeypair.publicKey,
    true
  );
  tx.instructions = [
    ...tx.instructions,
    SystemProgram.createAccount({
      fromPubkey: candyMachineAuthorityKeypair.publicKey,
      newAccountPubkey: candyMachineKeypair.publicKey,
      space: size,
      lamports: rent_exempt_lamports,
      programId: PROGRAM_ID,
    }),
    {
      ...initIx,
      keys: [
        ...initIx.keys,
        {
          pubkey: PAYMENT_MINT,
          isSigner: false,
          isWritable: false,
        },
      ],
    },
    cssInitIx,
  ];
  tx.feePayer = candyMachineAuthorityKeypair.publicKey;
  tx.recentBlockhash = latest.value.blockhash;
  tx.sign(candyMachineAuthorityKeypair, candyMachineKeypair);

  const strategy: BlockheightBasedTransactionConfirmationStrategy = {
    signature: utils.bytes.bs58.encode(tx.signature as Buffer),
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
  };

  const txid = await sendAndConfirmRawTransaction(
    connection,
    tx.serialize(),
    strategy,
  );
  
  console.log(
    `Succesfully created candy machine`, {
      cluster,
      tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
      txid,
      candymachine: candyMachineKeypair.publicKey.toBase58(),
      candymachine_account: `https://explorer.solana.com/address/${candyMachineKeypair.publicKey.toBase58()}?cluster=${cluster}`,
      authority: candyMachineAuthorityKeypair.publicKey.toBase58(),
      uuid: uuid,
    }
  );
};

createCandyMachine();
