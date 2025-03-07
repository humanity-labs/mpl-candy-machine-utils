import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createSetCssSettingsInstruction,
  createSetPermissionedSettingsInstruction,
  findCcsSettingsId,
  findPermissionedSettingsId,
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
const cluster = "mainnet";
let connection = connectionFor(cluster);
const candyMachineId = new PublicKey("C18WK75qhyG3CPocHwtLxt9VzRBuvjzKZR9vMJrFdq26");

const addLockupSettings = async () => {
  const rulesetId = findRulesetId();
  const [cssSettingsId] = await findCcsSettingsId(candyMachineId);

  console.debug(`> candyMachineId`, candyMachineId.toBase58());
  console.debug(`> rulesetId`, rulesetId.toBase58());
  console.debug(`> cssSettingsId`, cssSettingsId.toBase58());

  const tx = new Transaction();
  tx.add(
    createSetCssSettingsInstruction(
      {
        candyMachine: candyMachineId,
        authority: candyMachineAuthorityKeypair.publicKey,
        ccsSettings: cssSettingsId,
        payer: candyMachineAuthorityKeypair.publicKey,
      },
      {
        creator: candyMachineAuthorityKeypair.publicKey,
        ruleset: rulesetId,
      }
    )
  );

  tx.feePayer = candyMachineAuthorityKeypair.publicKey;
  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.sign(candyMachineAuthorityKeypair);
  
  return sendAndConfirmRawTransaction(connection, tx.serialize())
  .then(txid => {
    console.log(
      `Succesfully set permissioned settings for candy machine with address ${candyMachineId.toString()} https://explorer.solana.com/tx/${txid}?cluster=${cluster}`
    );
    return Promise.resolve();
  })
  .catch(err => {
    const e = err.toString().toLowerCase();
    if (e.indexOf('node is behind') > -1) {
      connection = connectionFor(cluster);
      return addLockupSettings();
    }
    else if (e.indexOf('blockhash not found') > -1) {
      connection = connectionFor(cluster);
      return addLockupSettings();
    }
    else {
      console.error(`[error]`, err);
      return Promise.reject(err);
    }
  });
};

addLockupSettings();
