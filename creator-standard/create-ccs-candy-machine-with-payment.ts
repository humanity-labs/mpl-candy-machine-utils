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
import {
  findRulesetId,
  identifyCCSToken,
  findMintManagerId,
  findMintMetadataId,
  // see https://github.com/cardinal-labs/cardinal-creator-standard/blob/main/tools/createCCSToken.ts
  createSetInUseByInstruction,
  createApproveAndSetInUseByInstruction,
  createRemoveInUseByInstruction,
  createTransferInstruction,
  createUpdateMintManagerInstruction,
  // see https://github.com/cardinal-labs/cardinal-creator-standard/blob/main/tools/createRuleset.ts
  createInitRulesetInstruction,
  createInitMintManagerInstruction,
  createUpdateRulesetInstruction,
} from "@cardinal/creator-standard";
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

const PAYMENT_MINT = new PublicKey(
  "tttvgrrNcjVZJS33UAcwTNs46pAidgsAgJqGfYGdZtG"
);
// const cluster = "devnet";
const cluster = 'mainnet';
const ITEMS_AVAILABLE = 500;
const PRICE = 2.5;
const GOLIVE = new Date("2022-12-17 20:00:00 UTC");

const uuidFromConfigPubkey = (configAccount: PublicKey) => {
  return configAccount.toBase58().slice(0, 6);
};

const createCandyMachine = async (): Promise<any> => {
  const connection = connectionFor(cluster);
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
        gatekeeper: null,
      },
    }
  );

  console.debug(`> Adding ccs settings..`);
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
        ccsSettingsId: cssSettingsId.toBase58(),
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
