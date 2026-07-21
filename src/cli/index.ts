#!/usr/bin/env node
import { Command } from "commander";
import { createGenerateCommand } from "./generate.js";

const program = new Command();

program
  .name("quest-forge")
  .description("Schema-first game content generator CLI")
  .version("0.1.0");

program.addCommand(createGenerateCommand());

program.parse(process.argv);
