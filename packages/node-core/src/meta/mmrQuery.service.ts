// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import assert from 'assert';
import {Controller} from '@nestjs/common';
import {u8aToHex} from '@subql/utils';
import {MMR} from '@subql/x-merkle-mountain-range';
import {Sequelize} from '@subql/x-sequelize';
import {MmrStoreType, NodeConfig} from '../configure/NodeConfig';
import {MmrProof, MmrPayload} from '../events';
import {baseMmrService, keccak256Hash, PgBasedMMRDB} from '../indexer';
import {getExistingProjectSchema} from '../utils';

// Currently only serve MMR query
export class PgMmrQueryDb extends PgBasedMMRDB {
  // eslint-disable-next-line @typescript-eslint/require-await
  async setLeafLength(length: number): Promise<number> {
    throw new Error('setLeafLength in PgMmrQueryDb should never been called');
  }
}

@Controller('mmrs')
export class MmrQueryService extends baseMmrService {
  private _db?: PgBasedMMRDB;
  constructor(nodeConfig: NodeConfig, private sequelize: Sequelize) {
    super(nodeConfig);
  }

  async init(offset: number): Promise<void> {
    this._blockOffset = offset;
    await this.ensureMmr();
  }

  get db(): PgBasedMMRDB {
    if (!this._db) {
      throw new Error('MMR Service PgBasedMMRDB has not been init');
    }
    return this._db;
  }

  async ensureMmr(): Promise<void> {
    if (this._mmrDb) {
      return;
    }
    if (this.nodeConfig.mmrStoreType === MmrStoreType.Postgres) {
      await this.ensurePostgresDb();
    } else {
      this._mmrDb = await this.ensureFileBasedMmr(this.nodeConfig.mmrPath);
    }
  }

  get mmrDb(): MMR {
    if (this.nodeConfig.mmrStoreType === MmrStoreType.Postgres) {
      // We need to reconstruct mmr from postgresDb
      // Due to leafLength in mmr only updated when append happens (in another mmr instance)
      // Which means it never get update in current mmr instance
      // Therefore, we need to get clean leafLength from db each time
      return new MMR(keccak256Hash, this.db);
    } else {
      if (!this._mmrDb) {
        throw new Error('MMR Service sync has not been called');
      }
      return this._mmrDb;
    }
  }

  private async ensurePostgresDb(): Promise<void> {
    const schema = await getExistingProjectSchema(this.nodeConfig, this.sequelize);
    assert(schema, 'Unable to find postges based MMR table. Do you need to migrate from file based MMR?');
    this._db = await PgMmrQueryDb.create(this.sequelize, schema);
  }

  async getMmr(blockHeight: number): Promise<MmrPayload> {
    const leafIndex = blockHeight - this.blockOffset - 1;
    if (leafIndex < 0) {
      throw new Error(`Parameter blockHeight must greater equal to ${this.blockOffset + 1} `);
    }
    const [mmrResponse, nodeResponse] = await Promise.allSettled([
      this.mmrDb.getRoot(leafIndex),
      this.mmrDb.get(leafIndex),
    ]);

    const mmrRoot =
      mmrResponse.status === 'fulfilled' ? u8aToHex(mmrResponse.value) : `mmrRoot error, ${mmrResponse.reason}`;
    const hash =
      nodeResponse.status === 'fulfilled' ? u8aToHex(nodeResponse.value) : `Error: ${nodeResponse.reason.message}`;

    return {
      offset: this.blockOffset,
      height: blockHeight,
      mmrRoot,
      hash,
    };
  }

  async getMmrProof(blockHeight: number): Promise<MmrProof> {
    const leafIndex = blockHeight - this.blockOffset - 1;
    if (leafIndex < 0) {
      throw new Error(`Parameter blockHeight must greater equal to ${this.blockOffset + 1} `);
    }
    const mmrProof = await this.mmrDb.getProof([leafIndex]);
    const nodes = Object.entries(mmrProof.db.nodes).map(([key, data]) => {
      return {
        node: key,
        hash: u8aToHex(data as Uint8Array),
      };
    });
    return {
      digest: mmrProof.digest.name,
      leafLength: mmrProof.db.leafLength,
      nodes,
    };
  }
}
