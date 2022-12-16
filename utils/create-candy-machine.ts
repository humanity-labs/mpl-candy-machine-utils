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
  PROGRAM_ID,
} from "@cardinal/mpl-candy-machine-utils";
import { BN, utils } from "@project-serum/anchor";
import { connectionFor } from "@cardinal/common";

// for environment variables
require("dotenv").config();

const path: string = process.env.WALLET_KEYPAIR || '';
const secretKeyString = fs.readFileSync(path, { encoding: 'utf8' })
const secretKey = Uint8Array.from(JSON.parse(secretKeyString))
const candyMachineAuthorityKeypair = Keypair.fromSecretKey(secretKey)

//const candyMachineAuthorityKeypair = Keypair.fromSecretKey(
//  utils.bytes.bs58.decode(process.env.WALLET_KEYPAIR || "")
//);
const candyMachineKeypair = Keypair.generate();
const cluster = "devnet";
const connection = connectionFor(cluster);
const ITEMS_AVAILABLE = 50;

const uuidFromConfigPubkey = (configAccount: PublicKey) => {
  return configAccount.toBase58().slice(0, 6);
};

const createCandyMachine = async () => {
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
        price: new BN(1),
        symbol: "BB",
        sellerFeeBasisPoints: 999,
        // supply of 1 is for NFT
        maxSupply: new BN(1),
        isMutable: true,
        retainAuthority: true,
        goLiveDate: new BN(Date.now() / 1000),
        endSettings: null,
        creators: [
          {
            address: candyMachineKeypair.publicKey,
            verified: true,
            share: 100,
          },
        ],
        hiddenSettings: null,
        /*
        hiddenSettings: {
          name: 'BB',
          uri: 'https://arweave.net/qfQArSHuQkAL2OKGn6aCfl9B4nQlGfcjA8XphRvkwlM',
          hash: [],
        },
        */
        whitelistMintSettings: null,
        itemsAvailable: new BN(ITEMS_AVAILABLE),
        gatekeeper: null,
      },
    }
  );

  const send: any = async (): Promise<any> => {
    const tx = new Transaction();
    const size =
      CONFIG_ARRAY_START +
      4 +
      ITEMS_AVAILABLE * CONFIG_LINE_SIZE +
      8 +
      2 * (Math.floor(ITEMS_AVAILABLE / 8) + 1);
    
    const rent_exempt_lamports = await connection.getMinimumBalanceForRentExemption(size);
    console.debug(`rent_exempt_lamports`, rent_exempt_lamports);
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
    ];

    // TODO: add spl-token instruction to freeze the token-account
    // ensure freeze authority is properly set, so that we can unfreeze

    // TODO: add transfer instruction to airdrop the token-mint to 
    // whitelist wallet address
    
    tx.feePayer = candyMachineAuthorityKeypair.publicKey;
    tx.recentBlockhash = latest.value.blockhash;
    tx.sign(candyMachineAuthorityKeypair, candyMachineKeypair);

    const strategy: BlockheightBasedTransactionConfirmationStrategy = {
      signature: utils.bytes.bs58.encode(tx.signature as Buffer),
      blockhash: latest.value.blockhash,
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
    };

    return sendAndConfirmRawTransaction(
      connection,
      tx.serialize(),
      strategy,
    )
    .then(txid => {
      const result = {
        cluster,
        tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
        txid,
        candymachine: candyMachineKeypair.publicKey.toBase58(),
        candymachine_account: `https://explorer.solana.com/address/${candyMachineKeypair.publicKey.toBase58()}?cluster=${cluster}`,
        authority: candyMachineAuthorityKeypair.publicKey.toBase58(),
        uuid: uuid,
      };

      console.log(`Succesfully created candy machine`, result);

      return Promise.resolve(result);
    })
    .catch(err => {
      if (err.toString().includes(`Blockhash not found`)) {
        console.error(`retrying..`);
        return send();
      }
      else if (err.toString().includes(`custom program error: 0x1`)) {
        console.error(`error sending mint transaction`, `INSUFFICIENT BALANCE`, err);
      }
      else {
        console.error(`error sending mint transaction`, err);
      }
    });
  };

  await send();
};

createCandyMachine();
