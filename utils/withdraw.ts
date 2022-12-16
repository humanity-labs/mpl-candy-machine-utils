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
  createWithdrawFundsInstruction,
  WithdrawFundsInstructionAccounts,
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
const candyMachineId = new PublicKey("3uDnkXFnANuCFnwp7Whis4cBBryRdHgbsTVokxgsSkf7");

const withdraw = async (): Promise<any> => {
  console.debug(`> candyMachineId`, candyMachineId.toBase58());
  
  const tx = new Transaction();
  tx.add(
    createWithdrawFundsInstruction(
      <WithdrawFundsInstructionAccounts>{
        candyMachine: candyMachineId,
        authority: candyMachineAuthorityKeypair.publicKey,
      }
    )
  );

  tx.feePayer = candyMachineAuthorityKeypair.publicKey;
  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.sign(candyMachineAuthorityKeypair);
  
  console.debug(``);
  console.debug(`Sending & broadcasting withdraw txn..`);
  return sendAndConfirmRawTransaction(connection, tx.serialize())
  .then(txid => {
    console.log(
      `Succesfully withdrew ${candyMachineId.toString()}`, {
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
      return withdraw();
    }
    else if (e.indexOf('blockhash not found') > -1) {
      connection = connectionFor(cluster);
      return withdraw();
    }
    else {
      console.error(`[error]`, err);
      return Promise.reject(err);
    }
  });
};

withdraw();
