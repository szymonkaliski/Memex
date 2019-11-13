import { browser, Browser } from 'webextension-polyfill-ts'
import StorageManager from '@worldbrain/storex'
import { SignalTransportFactory } from '@worldbrain/memex-common/lib/sync'
import NotificationBackground from 'src/notifications/background'
import SocialBackground from 'src/social-integration/background'
import DirectLinkingBackground from 'src/direct-linking/background'
import ActivityLoggerBackground, {
    TabManager,
} from 'src/activity-logger/background'
import SearchBackground from 'src/search/background'
import EventLogBackground from 'src/analytics/internal/background'
import CustomListBackground from 'src/custom-lists/background'
import TagsBackground from 'src/tags/background'
import BookmarksBackground from 'src/bookmarks/background'
import * as backup from '../backup/background'
import * as backupStorage from '../backup/background/storage'
import {
    registerModuleMapCollections,
    StorageModule,
} from '@worldbrain/storex-pattern-modules'
import { SharedSyncLog } from '@worldbrain/storex-sync/lib/shared-sync-log'
import { setupBlacklistRemoteFunctions } from 'src/blacklist/background'
import {
    setImportStateManager,
    ImportStateManager,
} from 'src/imports/background/state-manager'
import { setupImportBackgroundModule } from 'src/imports/background'
import SyncBackground from 'src/sync/background'
import BackgroundScript from '.'
import alarms from './alarms'
import { setupNotificationClickListener } from 'src/util/notifications'
import { StorageChangesManager } from 'src/util/storage-changes'
import { AuthBackground } from 'src/authentication/background'
import {
    createAuthDependencies,
    DevAuthState,
} from 'src/authentication/background/setup'

export interface BackgroundModules {
    auth: AuthBackground
    notifications: NotificationBackground
    social: SocialBackground
    activityLogger: ActivityLoggerBackground
    directLinking: DirectLinkingBackground
    search: SearchBackground
    eventLog: EventLogBackground
    customLists: CustomListBackground
    tags: TagsBackground
    bookmarks: BookmarksBackground
    backupModule: backup.BackupBackgroundModule
    sync: SyncBackground
    bgScript: BackgroundScript
}

export function createBackgroundModules(options: {
    storageManager: StorageManager
    browserAPIs: Browser
    signalTransportFactory: SignalTransportFactory
    getSharedSyncLog: () => Promise<SharedSyncLog>
    tabManager?: TabManager
    localStorageChangesManager: StorageChangesManager
    auth?: AuthBackground
    authOptions?: { devAuthState: DevAuthState }
}): BackgroundModules {
    const { storageManager } = options
    const tabManager = options.tabManager || new TabManager()

    const search = new SearchBackground({
        storageManager,
        tabMan: tabManager,
        browserAPIs: options.browserAPIs,
    })

    const notifications = new NotificationBackground({ storageManager })
    const social = new SocialBackground({ storageManager })
    const activityLogger = new ActivityLoggerBackground({
        searchIndex: search.searchIndex,
        browserAPIs: options.browserAPIs,
        tabManager,
    })
    const bgScript = new BackgroundScript({
        storageManager,
        storageChangesMan: options.localStorageChangesManager,
        notifsBackground: notifications,
        loggerBackground: activityLogger,
    })

    const auth =
        options.auth ||
        new AuthBackground(createAuthDependencies(options.authOptions))

    return {
        auth,
        notifications,
        social,
        activityLogger,
        directLinking: new DirectLinkingBackground({
            browserAPIs: options.browserAPIs,
            storageManager,
            socialBg: social,
            searchIndex: search.searchIndex,
        }),
        search,
        eventLog: new EventLogBackground({ storageManager }),
        customLists: new CustomListBackground({
            storageManager,
            tabMan: activityLogger.tabManager,
            windows: browser.windows,
            searchIndex: search.searchIndex,
        }),
        tags: new TagsBackground({
            storageManager,
            searchIndex: search.searchIndex,
            tabMan: activityLogger.tabManager,
            windows: browser.windows,
        }),
        bookmarks: new BookmarksBackground({ storageManager }),
        backupModule: new backup.BackupBackgroundModule({
            storageManager,
            searchIndex: search.searchIndex,
            lastBackupStorage: new backupStorage.LocalLastBackupStorage({
                key: 'lastBackup',
            }),
            notifications,
        }),
        sync: new SyncBackground({
            auth: {
                getCurrentUser: async () => {
                    const user = await auth.authService.getUser()
                    return user ? { id: user.uid } : null
                },
                generateLoginToken: () =>
                    auth.authService['auth'].generateLoginToken(),
                loginWithToken: (token: string) =>
                    auth.authService['auth'].loginWithToken(token),
            },
            signalTransportFactory: options.signalTransportFactory,
            storageManager,
            getSharedSyncLog: options.getSharedSyncLog,
            browserAPIs: options.browserAPIs,
            appVersion: process.env.VERSION,
        }),
        bgScript,
    }
}

export async function setupBackgroundModules(
    backgroundModules: BackgroundModules,
) {
    setImportStateManager(
        new ImportStateManager({
            searchIndex: backgroundModules.search.searchIndex,
        }),
    )
    setupImportBackgroundModule({
        searchIndex: backgroundModules.search.searchIndex,
        tagsModule: backgroundModules.tags,
        customListsModule: backgroundModules.customLists,
    })

    backgroundModules.auth.registerRemoteEmitter()
    backgroundModules.notifications.setupRemoteFunctions()
    backgroundModules.social.setupRemoteFunctions()
    backgroundModules.directLinking.setupRemoteFunctions()
    backgroundModules.directLinking.setupRequestInterceptor()
    backgroundModules.activityLogger.setupRemoteFunctions()
    backgroundModules.activityLogger.setupWebExtAPIHandlers()
    backgroundModules.search.setupRemoteFunctions()
    backgroundModules.eventLog.setupRemoteFunctions()
    backgroundModules.customLists.setupRemoteFunctions()
    backgroundModules.tags.setupRemoteFunctions()
    backgroundModules.backupModule.setBackendFromStorage()
    backgroundModules.backupModule.setupRemoteFunctions()
    backgroundModules.backupModule.startRecordingChangesIfNeeded()
    backgroundModules.bgScript.setupRemoteFunctions()
    backgroundModules.bgScript.setupWebExtAPIHandlers()
    backgroundModules.bgScript.setupAlarms(alarms)
    setupNotificationClickListener()
    setupBlacklistRemoteFunctions()
    backgroundModules.backupModule.storage.setupChangeTracking()

    await backgroundModules.sync.setup()
}

export function getBackgroundStorageModules(
    backgroundModules: BackgroundModules,
): { [moduleName: string]: StorageModule } {
    return {
        annotations: backgroundModules.directLinking.annotationStorage,
        notifications: backgroundModules.notifications.storage,
        customList: backgroundModules.customLists.storage,
        bookmarks: backgroundModules.bookmarks.storage,
        backup: backgroundModules.backupModule.storage,
        eventLog: backgroundModules.eventLog.storage,
        search: backgroundModules.search.storage,
        social: backgroundModules.social.storage,
        tags: backgroundModules.tags.storage,
        clientSyncLog: backgroundModules.sync.clientSyncLog,
    }
}

export function registerBackgroundModuleCollections(
    storageManager: StorageManager,
    backgroundModules: BackgroundModules,
) {
    registerModuleMapCollections(
        storageManager.registry,
        getBackgroundStorageModules(backgroundModules),
    )
}
