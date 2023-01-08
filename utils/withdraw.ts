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
  CandyMachine,
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

const authorityKeypair = loadKeypair();
const cluster = 'mainnet';
let connection = connectionFor(cluster);

const candyMachineIds: string[] = [
  // '3uDnkXFnANuCFnwp7Whis4cBBryRdHgbsTVokxgsSkf7',
  // '4CJh7ZXtD97Q4TKpvg2KbJpUbDRsdrthP8Z9ELXyX6XE',
  // 'Bw77sJzVmd4qPJuDy8UQ8vekruh29tnU5JG2VQcGWQyG',
  // 'CzWjqMH49PAza9NBsGSFfkg6S3H9EcKLLQKtw5V6Ksx8',
  // '36xvU9DQkLQX7Gp9dkyb2fhQS6vXsSsh3nPKCwrrkWQK',
  // '54Xp3fdTSXWXrne5QCaESvbPAkH1BQ14oStN619QhRki',
  // '4tqcribAbFPkPc3AtW6h86BiZmVYNLJDe4p8NDvx1ir3',
  // 'Fcwgwq2mZjzqsfsLJqem8DzvXWnw7Q7B8GpR5mDaiw7F',
  // 'CW1nVx3B1Z5LGHH9iiiB6qkU5WKjRP6Qu3Lm9kKt74fE',
  // '37B4a6zJuEkFnrd4aPwD97PwEVpGciLBYWn74G7K97Q6',
  // 'C2FiYbQg5z5mb696oUuQdBQPbzQUa43p7uSRD4UomF3z',
  // 'Fo3L6hAxVnZdU6tEzN4h9EqZdMsUjdUXYZJ6PkBarH7h',
  // 'BcXLhVftPMhgTFyexmZem8JjPFQMWheNqMDfabYRzAqf',
  // 'FyBieRBPkiVgD44mJ9coTyB1NCHTFNmGguoZ22nN43kG',
  // '8WtmaAFjBEmAjfuBkjutcdYEDFogdH27CVFkVD257151',
  // 'BPbHupxWqjJxDQT9LaCo583R1JgMRqcHSfJLVzu7RdYn',
  // '5GcsLZW2btfQV8h9LB34jeCbnmWGVdKEwyyyWhUpTqTd',
  // 'GXm6zUsjocAKdB9EAavmYP5Gb7g3mPZgnPbAP38ArA9K',
  // 'E11Wtp1YfVSrmoBoKTGL1KVLFYyujxRR4VVzDtxNg4va',
  // 'ADHxtDFMZR9mh6xqFYyb16TPhTqABcU3MAPLpdeWWeoP',
  // 'HBC5x7YG9atpv3W5oxoAkjDSc27jYYm1aJv19nr2McGW',
  // 'FyBieRBPkiVgD44mJ9coTyB1NCHTFNmGguoZ22nN43kG',
  // 'ATNJnEvNCC14RVNUsiWC7p1LSu13HeCvP6VcpaYuabrZ',
  // '5tuNoaGvPLHBGKSUbxj4y5xoxquFDLzhYhLexaYxZYjY',
  // 'FXAkvpa1AwmovN6NuY3Nm2vkLoGcGiiXeuqHSwSWfqrB',
  // traits airdrop
  // '4WftdHP2pc7bn1RdjLej3VLHxSqDfwxpuFErqWQH5DWB',
];

const withdraw = async (): Promise<any> => {

  // find candyMachine accounts..
  const builder = CandyMachine.gpaBuilder();
  builder.addFilter('authority', authorityKeypair.publicKey);
  const accounts = await builder.run(connection);
  console.debug(`> account search`, accounts.length);
  accounts.map((account, idx) => {
    console.debug(`> account`, idx, {
      pubkey: account.pubkey.toBase58(),
    });
    candyMachineIds.push(account.pubkey.toBase58());
  });

  const ops = candyMachineIds.map(async (id) => {
    const candyMachineId = new PublicKey(id);
    console.debug(`> candyMachineId`, candyMachineId.toBase58());
    
    const tx = new Transaction();
    tx.add(
      createWithdrawFundsInstruction(
        <WithdrawFundsInstructionAccounts>{
          candyMachine: candyMachineId,
          authority: authorityKeypair.publicKey,
        }
      )
    );
  
    const latest = await connection.getRecentBlockhash()
    .catch(err => console.warn(`> error fetching recent blockhash..`));
    if (!latest?.blockhash) return withdraw();
  
    tx.feePayer = authorityKeypair.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(authorityKeypair);
    
    console.debug(``);
    console.debug(`Sending & broadcasting withdraw txn..`);
    return sendAndConfirmRawTransaction(connection, tx.serialize())
    .then(txid => {
      console.info(
        `Succesfully withdrew ${candyMachineId.toString()}`, {
          candyMachine: candyMachineId.toBase58(),
          tx: `https://explorer.solana.com/tx/${txid}?cluster=${cluster}`,
        }
      );
      return Promise.resolve(txid);
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
  });
  await Promise.allSettled(ops);
};

withdraw();
