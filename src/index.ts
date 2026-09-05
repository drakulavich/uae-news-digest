#!/usr/bin/env bun
import { main } from './cli/program';

process.exitCode = await main(process.argv);
