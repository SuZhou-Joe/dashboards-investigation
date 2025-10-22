/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { first } from 'rxjs/operators';
import { AppMountParameters, CoreSetup, CoreStart, Plugin } from '../../../src/core/public';
import {
  investigationNotebookID,
  investigationNotebookPluginOrder,
  investigationNotebookTitle,
} from '../common/constants/shared';
import { setOSDHttp, setOSDSavedObjectsClient, uiSettingsService } from '../common/utils';
import { registerAllPluginNavGroups } from './plugin_helpers/plugin_nav';
import PPLService from './services/requests/ppl';
import {
  AppPluginStartDependencies,
  InvestigationSetup,
  InvestigationStart,
  NoteBookServices,
  SetupDependencies,
} from './types';

import './index.scss';
import { DataDistributionEmbeddableFactory } from './components/notebooks/components/data_distribution/embeddable/data_distribution_embeddable_factory';
import {
  setClient,
  setData,
  setDataSourceManagementSetup,
  setEmbeddable,
  setExpressions,
  setSearch,
  ParagraphService,
  setNotifications,
  setVisualizations,
  FindingService,
} from './services';
import {
  ClassicNotebook,
  ClassicNotebookProps,
} from './components/notebooks/components/classic_notebook';
import { NOTEBOOK_APP_NAME } from '../common/constants/notebooks';
import { OpenSearchDashboardsContextProvider } from '../../../src/plugins/opensearch_dashboards_react/public';
import { paragraphRegistry } from './paragraphs';
import { ContextService } from './services/context_service';
import { ChatContext, ISuggestionProvider } from '../../dashboards-assistant/public';
import { OSDAGUIAgent } from './agent/osd_ag_ui_agent';
import { RunAgentInput } from '../common/types/ag_ui_types';

export class InvestigationPlugin
  implements
    Plugin<InvestigationSetup, InvestigationStart, SetupDependencies, AppPluginStartDependencies> {
  private paragraphService: ParagraphService;
  private contextService: ContextService;
  private chatbotContext$ = new BehaviorSubject<Array<Record<string, unknown> | null>>([]);
  private startDeps: AppPluginStartDependencies | undefined;

  constructor() {
    this.paragraphService = new ParagraphService();
    this.contextService = new ContextService();
  }

  public async setup(
    core: CoreSetup<AppPluginStartDependencies>,
    setupDeps: SetupDependencies
  ): Promise<InvestigationSetup> {
    uiSettingsService.init(core.uiSettings, core.notifications);
    setOSDHttp(core.http);
    core.getStartServices().then(([coreStart]) => {
      setOSDSavedObjectsClient(coreStart.savedObjects.client);
    });

    // Setup paragraph service
    const paragraphServiceSetup = this.paragraphService.setup();

    // Register paragraph types
    paragraphRegistry.forEach(({ types, item }) => {
      paragraphServiceSetup.register(types, item);
    });
    const contextServiceSetup = await this.contextService.setup();

    const findingService = new FindingService();

    const getServices = async () => {
      const [coreStart, depsStart] = await core.getStartServices();
      const pplService: PPLService = new PPLService(core.http);
      const services: NoteBookServices = {
        ...coreStart,
        ...depsStart,
        appName: NOTEBOOK_APP_NAME,
        pplService,
        savedObjects: coreStart.savedObjects,
        paragraphService: paragraphServiceSetup,
        contextService: contextServiceSetup,
        updateContext: this.updateContext,
        findingService,
      };
      return services;
    };

    const appMountWithStartPage = () => async (params: AppMountParameters) => {
      const { Observability } = await import('./components/index');
      const services = await getServices();
      return Observability({ ...services, appMountService: params }, params!);
    };

    setupDeps.assistantDashboards?.registerSuggestionProvider?.({
      id: 'finding',
      priority: 1,
      isEnabled: () => true,
      getSuggestions: async (context: ChatContext) => {
        const [coreStart] = await core.getStartServices();
        const currentAppId = await coreStart.application.currentAppId$.pipe(first()).toPromise();
        if (
          currentAppId !== investigationNotebookID ||
          !findingService.currentNotebookId ||
          !context.currentMessage ||
          !context.currentMessage.content
        ) {
          return [];
        }

        return [
          {
            actionType: 'customize',
            message: 'Add current result to investigation as a finding',
            action: async () => {
              console.log('Adding a new finding from chatbot plugin...');
              const input = context.messageHistory.findLast((message) => message.type === 'input')
                ?.content;
              const output = context.currentMessage?.content;

              const notebookId = context.pageContext?.['notebookId'];

              if (input && output) {
                try {
                  await findingService.addFinding(input, output, notebookId);
                  return true;
                } catch (error) {
                  // Return false to indicate failure to the suggestion system
                  return false;
                }
              }
              return false;
            },
          },
        ];
      },
    } as ISuggestionProvider);

    core.application.register({
      id: investigationNotebookID,
      title: investigationNotebookTitle,
      order: investigationNotebookPluginOrder,
      mount: appMountWithStartPage(),
    });

    registerAllPluginNavGroups(core);

    setupDeps.embeddable.registerEmbeddableFactory(
      'vega_visualization',
      new DataDistributionEmbeddableFactory()
    );

    setDataSourceManagementSetup(
      !!setupDeps.dataSourceManagement
        ? {
            enabled: true,
            dataSourceManagement: setupDeps.dataSourceManagement,
          }
        : {
            enabled: false,
            dataSourceManagement: undefined,
          }
    );

    // TODO: check if we need to expose agentic notebook
    const getNotebook = async ({ openedNoteId }: Pick<ClassicNotebookProps, 'openedNoteId'>) => {
      const services = await getServices();

      return (
        <OpenSearchDashboardsContextProvider services={services}>
          <ClassicNotebook openedNoteId={openedNoteId} />
        </OpenSearchDashboardsContextProvider>
      );
    };
    // Return methods that should be available to other plugins
    return {
      ui: {
        getNotebook,
      },
    };
  }

  public start(core: CoreStart, startDeps: AppPluginStartDependencies): InvestigationStart {
    setExpressions(startDeps.expressions);
    setData(startDeps.data);
    setSearch(startDeps.data.search);
    setClient(core.http);
    setEmbeddable(startDeps.embeddable);
    setNotifications(core.notifications);
    setVisualizations(startDeps.visualizations);
    this.startDeps = startDeps;
    startDeps.contextProvider?.registerContextContributor({
      appId: investigationNotebookID,
      captureStaticContext: async () => ({
        investigation: this.chatbotContext$
          .getValue()
          .filter((item) => item)
          .map((item, index) => ({
            level: index,
            ...item,
          })),
      }),
    });

    const agentId = '5DhNC5oB45oSINnwrD1e';

    const input: RunAgentInput = {
      threadId: `thread-${Date.now()}-pj44w6ive`,
      runId: `run-${Date.now()}-gu67vx1jl`,
      messages: [
        {
          id: `msg-${Date.now()}-epujp4bi6`,
          role: 'user',
          content: 'hello',
        },
      ],
      tools: [
        {
          name: 'execute_ppl_query',
          description: 'Update the query bar with a PPL query and optionally execute it',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The PPL query to set in the query bar',
              },
              autoExecute: {
                type: 'boolean',
                description: 'Whether to automatically execute the query (default: true)',
              },
              description: {
                type: 'string',
                description: 'Optional description of what the query does',
              },
            },
            required: ['query'],
          },
        },
      ],
      context: [
        {
          description: 'Explore application page context',
          value:
            '{"appId":"explore","timeRange":{"from":"now-15m","to":"now"},"query":{"query":"","language":"PPL"}}',
        },
      ],
    };

    const agent = new OSDAGUIAgent({
      makeHttpRequest: (inputParams, signal) =>
        core.http
          .post(`/api/investigation/${agentId}/execute/stream`, {
            signal,
            asResponse: true,
            query: {
              dataSourceId: '7dc717f0-af11-11f0-b19c-eb5fb18bf285',
            },
            body: JSON.stringify(inputParams),
          })
          .then((res) => res.response as Response),
    });

    const resultObservable = agent.runAgent(input);

    resultObservable.subscribe((result) => console.log('result', result));

    // Export so other plugins can use this flyout
    return {};
  }

  private updateContext = (level: number, context: Record<string, unknown> | null) => {
    const value = this.chatbotContext$.getValue();
    value[level] = context;
    this.chatbotContext$.next(value);
    this.startDeps?.contextProvider?.refreshCurrentContext();
  };

  public stop() {}
}
