import { Module } from '@cmmv/core';

import { CacheService } from '../services/cache.service';

export let CacheModule = new Module('cache', {
    providers: [CacheService],
});