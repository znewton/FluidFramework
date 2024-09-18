/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { NullExternalStorageManager } from "../externalStorageManager";
import {
	IRepoManagerParams,
	IRepositoryManagerFactory,
	type IRepositoryManager,
	type IStorageDirectoryConfig,
} from "./definitions";
import { MemFsManagerFactory } from "./filesystems";
import { IsomorphicGitManagerFactory } from "./isomorphicgitManager";

export class InMemoryRepoManagerFactory implements IRepositoryManagerFactory {
	private readonly memfsVolumeCache: Map<string, MemFsManagerFactory> = new Map();

	constructor(
		private readonly storageDirectoryConfig: IStorageDirectoryConfig,
		private readonly repoPerDocEnabled: boolean,
		private readonly enableRepositoryManagerMetrics: boolean,
		private readonly enableSlimGitInit: boolean,
	) {}

	public async create(params: IRepoManagerParams): Promise<IRepositoryManager> {
		const inMemoryRepoManager = await this.getRepoFactory(params).create(params);
		return inMemoryRepoManager;
	}

	public async open(params: IRepoManagerParams): Promise<IRepositoryManager> {
		const inMemoryRepoManager = await this.getRepoFactory(params).create(params);
		return inMemoryRepoManager;
	}

	public async delete(params: IRepoManagerParams): Promise<void> {
		const inMemoryFsManagerFactory = this.memfsVolumeCache.get(this.getRepoCacheKey(params));
		if (inMemoryFsManagerFactory) {
			inMemoryFsManagerFactory.volume.reset();
			this.memfsVolumeCache.delete(params.repoName);
		}
	}

	private getRepoCacheKey(params: IRepoManagerParams): string {
		return `${params.repoOwner}/${params.repoName}`;
	}

	private getRepoFactory(params: IRepoManagerParams): IsomorphicGitManagerFactory {
		const cachedMemFsFactory = this.memfsVolumeCache.get(this.getRepoCacheKey(params));
		const memFsFactory = cachedMemFsFactory ?? new MemFsManagerFactory();
		if (!cachedMemFsFactory) {
			this.memfsVolumeCache.set(this.getRepoCacheKey(params), memFsFactory);
		}
		return new IsomorphicGitManagerFactory(
			this.storageDirectoryConfig,
			{
				defaultFileSystemManagerFactory: memFsFactory,
				ephemeralFileSystemManagerFactory: memFsFactory,
			},
			new NullExternalStorageManager(),
			this.repoPerDocEnabled,
			this.enableRepositoryManagerMetrics,
			this.enableSlimGitInit,
		);
	}
}
