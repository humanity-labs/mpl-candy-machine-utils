import fs from "fs";
import {
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createWithdrawFundsInstruction,
  WithdrawFundsInstructionAccounts,
} from "@cardinal/mpl-candy-machine-utils";
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
// const candyMachineId = new PublicKey("3uDnkXFnANuCFnwp7Whis4cBBryRdHgbsTVokxgsSkf7");
// const candyMachineId = new PublicKey("4CJh7ZXtD97Q4TKpvg2KbJpUbDRsdrthP8Z9ELXyX6XE");
// const candyMachineId = new PublicKey("Bw77sJzVmd4qPJuDy8UQ8vekruh29tnU5JG2VQcGWQyG");
// const candyMachineId = new PublicKey("CzWjqMH49PAza9NBsGSFfkg6S3H9EcKLLQKtw5V6Ksx8");
// const candyMachineId = new PublicKey("36xvU9DQkLQX7Gp9dkyb2fhQS6vXsSsh3nPKCwrrkWQK");
// const candyMachineId = new PublicKey("54Xp3fdTSXWXrne5QCaESvbPAkH1BQ14oStN619QhRki");
// const candyMachineId = new PublicKey("4tqcribAbFPkPc3AtW6h86BiZmVYNLJDe4p8NDvx1ir3");
// const candyMachineId = new PublicKey("Fcwgwq2mZjzqsfsLJqem8DzvXWnw7Q7B8GpR5mDaiw7F");
// const candyMachineId = new PublicKey("CW1nVx3B1Z5LGHH9iiiB6qkU5WKjRP6Qu3Lm9kKt74fE");
// const candyMachineId = new PublicKey("37B4a6zJuEkFnrd4aPwD97PwEVpGciLBYWn74G7K97Q6");
// const candyMachineId = new PublicKey("C2FiYbQg5z5mb696oUuQdBQPbzQUa43p7uSRD4UomF3z");
// const candyMachineId = new PublicKey("Fo3L6hAxVnZdU6tEzN4h9EqZdMsUjdUXYZJ6PkBarH7h");
// const candyMachineId = new PublicKey("BcXLhVftPMhgTFyexmZem8JjPFQMWheNqMDfabYRzAqf");
const candyMachineId = new PublicKey("FyBieRBPkiVgD44mJ9coTyB1NCHTFNmGguoZ22nN43kG");

// const cluster = "devnet";
// const candyMachineId = new PublicKey("C3f8GUjKHeX6DdWqeAnwH3S5kfyz86mNFx11i6PgPQjA");
// const candyMachineId = new PublicKey("23DFmY1W1CFHY7BBLuevD8mfPJyqwWtXBWgLJBjJj2YZ");
// const candyMachineId = new PublicKey("AdssLxLWzAP52xudgoUCX684u9tgCiYCZYC5DhMAwtAc");
// const candyMachineId = new PublicKey("8w8nz9demuo1ND5ssAcVKCsb6nxzgJjfYbV6vx3ZHBzq");

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
