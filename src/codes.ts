import { customAlphabet } from "nanoid";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const CODE_LENGTH = 7;
export const CODE_PATTERN = /^[a-zA-Z0-9]{7}$/;

export type CodeGenerator = () => string;

export const generateCode: CodeGenerator = customAlphabet(ALPHABET, CODE_LENGTH);
