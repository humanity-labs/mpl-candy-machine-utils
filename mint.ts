import fs from 'fs';
import * as dotenv from "dotenv";
import {
  ComputeBudgetProgram,
  AccountMeta,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  BlockheightBasedTransactionConfirmationStrategy,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  Transaction,
  Cluster,
} from "@solana/web3.js";
import {
  createMintNftInstruction,
  PROGRAM_ID,
  CandyMachine,
  findLockupSettingsId,
  findPermissionedSettingsId,
  remainingAccountsForPermissioned,
  createSetCollectionDuringMintInstruction,
  findCcsSettingsId,
  remainingAccountsForCcs,
  CCSSettings,
} from "@cardinal/mpl-candy-machine-utils";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Edition,
  MasterEdition,
  Metadata,
  MetadataProgram,
} from "@metaplex-foundation/mpl-token-metadata";
import { remainingAccountsForLockup } from "@cardinal/mpl-candy-machine-utils";
import { findAta } from "@cardinal/token-manager";
import { connectionFor } from "./connection";
import { keypairFrom } from "./utils";
import { Wallet, utils } from "@project-serum/anchor";

dotenv.config();

const walletKeypair = keypairFrom(process.env.WALLET_KEYPAIR, "Wallet");
console.debug(`walletKeypair`, walletKeypair.publicKey.toBase58());
const payerKeypair = process.env.PAYER_KEYPAIR
  ? keypairFrom(process.env.PAYER_KEYPAIR, "Payer")
  : walletKeypair;
console.debug(`payerKeypair`, payerKeypair.publicKey.toBase58());

const candyMachineId = new PublicKey(process.env.CANDY_MACHINE_ID || "");
let collectionMintKeypair: Keypair | null = null;

const cluster = "devnet";

export const mint = async (
  wallet: Wallet,
  candyMachineId: PublicKey,
  cluster: Cluster | "mainnet" | "localnet",
  payerWallet?: Wallet
) => {
  const connection = connectionFor(cluster);
  const payerId = payerWallet?.publicKey ?? wallet.publicKey;
  console.debug(`wallet`, wallet.publicKey.toBase58());
  console.debug(`payerId`, payerId.toBase58());

  const nftToMintKeypair = Keypair.generate();
  console.debug(`nftToMintKeypair`, nftToMintKeypair.publicKey.toBase58());

  const tokenAccountToReceive = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    nftToMintKeypair.publicKey,
    wallet.publicKey,
    false
  );
  console.debug(`tokenAccountToReceive`, tokenAccountToReceive.toBase58());

  const metadataId = await Metadata.getPDA(nftToMintKeypair.publicKey);
  console.debug(`metadataId`, metadataId.toBase58());

  const masterEditionId = await Edition.getPDA(nftToMintKeypair.publicKey);
  const [candyMachineCreatorId, candyMachineCreatorIdBump] =
    await PublicKey.findProgramAddress(
      [Buffer.from("candy_machine"), candyMachineId.toBuffer()],
      PROGRAM_ID
    );

  const candyMachine = await CandyMachine.fromAccountAddress(
    connection,
    candyMachineId
  );
  console.log(`> Creating mint instruction`);
  const mintIx = createMintNftInstruction(
    {
      candyMachine: candyMachineId,
      candyMachineCreator: candyMachineCreatorId,
      payer: payerId,
      wallet: candyMachine.wallet,
      metadata: metadataId,
      mint: nftToMintKeypair.publicKey,
      mintAuthority: wallet.publicKey,
      updateAuthority: wallet.publicKey,
      masterEdition: masterEditionId,
      tokenMetadataProgram: MetadataProgram.PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      recentBlockhashes: SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      instructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
    {
      creatorBump: candyMachineCreatorIdBump,
    }
  );
  const remainingAccounts: AccountMeta[] = [];

  // Payment
  if (candyMachine.tokenMint) {
    console.log(`> Add payment accounts`);
    const payerTokenAccount = await findAta(
      candyMachine.tokenMint,
      payerId,
      true
    );
    console.debug(`payerTokenAccount`, payerTokenAccount.toBase58());

    remainingAccounts.push(
      {
        pubkey: payerTokenAccount,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: payerId,
        isWritable: true,
        isSigner: false,
      }
    );
  }

  // Inline minting
  console.log(`> Adding mint accounts`);
  remainingAccounts.push({
    pubkey: tokenAccountToReceive,
    isSigner: false,
    isWritable: true,
  });

  // Lockup settings
  const [lockupSettingsId] = await findLockupSettingsId(candyMachineId);
  console.debug(`lockupSettingsId`, lockupSettingsId.toBase58());

  const lockupSettings = await connection.getAccountInfo(lockupSettingsId);
  if (lockupSettings) {
    console.log(`> Adding lockup settings accounts`);
    remainingAccounts.push(
      ...(await remainingAccountsForLockup(
        candyMachineId,
        nftToMintKeypair.publicKey,
        tokenAccountToReceive
      ))
    );

    remainingAccounts.forEach((remainingAccount, i) => {
      console.debug(`remainingAccounts ${i}`, remainingAccount.pubkey.toBase58());
    });

  }

  // Permissioned settings
  const [permissionedSettingsId] = await findPermissionedSettingsId(
    candyMachineId
  );
  console.debug(`permissionedSettingsId`, permissionedSettingsId.toBase58());

  const permissionedSettings = await connection.getAccountInfo(
    permissionedSettingsId
  );
  if (permissionedSettings) {
    console.log(`> Adding permissioned settings accounts`);
    remainingAccounts.push(
      ...(await remainingAccountsForPermissioned(
        candyMachineId,
        nftToMintKeypair.publicKey,
        tokenAccountToReceive
      ))
    );
  }

  // CSS settings
  const [cssSettingsId] = await findCcsSettingsId(candyMachineId);
  console.debug(`cssSettingsId`, cssSettingsId.toBase58());

  const cssSettings = await connection.getAccountInfo(cssSettingsId);
  if (cssSettings) {
    const ccsSettingsData = await CCSSettings.fromAccountAddress(
      connection,
      cssSettingsId
    );
    console.log(`> Adding css settings accounts`);
    remainingAccounts.push(
      ...(await remainingAccountsForCcs(
        connection,
        wallet,
        candyMachineId,
        ccsSettingsData.creator,
        nftToMintKeypair.publicKey,
        tokenAccountToReceive,
        ""
      ))
    );
  }

  // Minting
  const instructions = [
    ComputeBudgetProgram.requestUnits({
      units: 400000,
      additionalFee: 0,
    }),
    {
      ...mintIx,
      keys: [
        ...mintIx.keys.map((k) =>
          k.pubkey.equals(nftToMintKeypair.publicKey)
            ? { ...k, isSigner: true }
            : k
        ),
        // remaining accounts for locking
        ...remainingAccounts,
      ],
    },
  ];

  // Collections
  if (collectionMintKeypair) {
    const [collectionPdaId, _collectionPdaBump] =
      await PublicKey.findProgramAddress(
        [Buffer.from("collection"), candyMachineId.toBuffer()],
        PROGRAM_ID
      );
    const collectionMintMetadataId = await Metadata.getPDA(
      collectionMintKeypair.publicKey
    );
    const collectionMasterEditionId = await MasterEdition.getPDA(
      collectionMintKeypair.publicKey
    );

    const [collectionAuthorityRecordId] = await PublicKey.findProgramAddress(
      [
        Buffer.from("metadata"),
        MetadataProgram.PUBKEY.toBuffer(),
        collectionMintKeypair.publicKey.toBuffer(),
        Buffer.from("collection_authority"),
        collectionPdaId.toBuffer(),
      ],
      MetadataProgram.PUBKEY
    );

    instructions.push(
      createSetCollectionDuringMintInstruction({
        candyMachine: candyMachineId,
        metadata: metadataId,
        payer: walletKeypair.publicKey,
        collectionPda: collectionPdaId,
        tokenMetadataProgram: MetadataProgram.PUBKEY,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        collectionMint: collectionMintKeypair.publicKey,
        collectionMasterEdition: collectionMasterEditionId,
        collectionMetadata: collectionMintMetadataId,
        authority: walletKeypair.publicKey,
        collectionAuthorityRecord: collectionAuthorityRecordId,
      })
    );
  }

  const latest = await connection.getLatestBlockhashAndContext();

  const tx = new Transaction();
  tx.instructions = instructions;
  tx.feePayer = payerId;
  tx.recentBlockhash = latest.value.blockhash;

  console.debug(`signing with recipient wallet`, wallet.publicKey.toBase58());
  await wallet.signTransaction(tx);

  if (payerWallet) {
    console.debug(`signing with payerWallet`, payerWallet.publicKey.toBase58());
    await payerWallet.signTransaction(tx)
  }
  await tx.partialSign(nftToMintKeypair);
  
  const strategy: BlockheightBasedTransactionConfirmationStrategy = {
    signature: utils.bytes.bs58.encode(tx.signature as Buffer),
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
  };

  const txid = await sendAndConfirmRawTransaction(
    connection,
    tx.serialize(),
    strategy,
  ).catch(err => {
    console.error(`error sending mint transaction`, err);
  });
  
  console.log(
    `Succesfully minted token`, {
      cluster,
      tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
      txid,
      mint: nftToMintKeypair.publicKey.toBase58(),
      mint_account: `https://explorer.solana.com/address/${nftToMintKeypair.publicKey.toBase58()}?cluster=${cluster}`,
      candymachine: candyMachineId.toBase58(),
      candymachine_account: `https://explorer.solana.com/address/${candyMachineId.toBase58()}?cluster=${cluster}`,
    }
  );

  return txid;
};

const main = async () => {
  // 1
  await mint(
    new Wallet(walletKeypair),
    candyMachineId,
    cluster,
    new Wallet(payerKeypair)
  ).then((d) => console.log(`Ouput: `, d, `\n`));

  // 2
  await mint(
    new Wallet(walletKeypair),
    candyMachineId,
    cluster,
    new Wallet(payerKeypair)
  ).then((d) => console.log(`Ouput: `, d, `\n`));

  // 3
  await mint(
    new Wallet(walletKeypair),
    candyMachineId,
    cluster,
    new Wallet(payerKeypair)
  ).then((d) => console.log(`Ouput: `, d, `\n`));

  // 4
  await mint(
    new Wallet(walletKeypair),
    candyMachineId,
    cluster,
    new Wallet(payerKeypair)
  ).then((d) => console.log(`Ouput: `, d, `\n`));

  // 5
  await mint(
    new Wallet(walletKeypair),
    candyMachineId,
    cluster,
    new Wallet(payerKeypair)
  ).then((d) => console.log(`Ouput: `, d, `\n`));

};

main().catch((e) => console.log(`[error]`, e));
