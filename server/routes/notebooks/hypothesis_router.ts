/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { schema } from '@osd/config-schema';
import uuid from 'uuid';
import {
  IOpenSearchDashboardsResponse,
  IRouter,
  ResponseError,
} from '../../../../../src/core/server';
import { SavedObjectsClientContract } from '../../../../../src/core/server/types';
import { NOTEBOOKS_API_PREFIX } from '../../../common/constants/notebooks';
import { NOTEBOOK_SAVED_OBJECT } from '../../../common/types/observability_saved_object_attributes';
import { HypothesisItem, NotebookBackendType, ParagraphBackendType, PERAgentInvestigationResponse } from '../../../common/types/notebooks';
import { getOpenSearchClientTransport } from '../utils';
import { createParagraphs, updateRunFetchParagraph } from '../../adaptors/notebooks/saved_objects_paragraphs_router';

export function registerHypothesisRoute(router: IRouter) {
  // Create Hypothesis
  router.post(
    {
      path: `${NOTEBOOKS_API_PREFIX}/savedNotebook/{noteId}/hypothesis`,
      validate: {
        params: schema.object({
          noteId: schema.string(),
        }),
        body: schema.object({
          title: schema.string(),
          description: schema.string(),
          likelihood: schema.number({ min: 1, max: 10 }),
          supportingFindingParagraphIds: schema.arrayOf(schema.string()),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      const opensearchNotebooksClient: SavedObjectsClientContract =
        context.core.savedObjects.client;

      try {
        const { noteId } = request.params;
        const { title, description, likelihood, supportingFindingParagraphIds } = request.body;

        // Get existing notebook
        const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
        const notebook = notebookObject.attributes.savedNotebook;

        // Create new hypothesis
        const newHypothesis: HypothesisItem = {
          id: 'hypothesis_' + uuid(),
          title,
          description,
          likelihood,
          supportingFindingParagraphIds,
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };

        // Add hypothesis to notebook
        const updatedNotebook = {
          ...notebook,
          hypotheses: [...(notebook.hypotheses || []), newHypothesis],
          dateModified: new Date().toISOString(),
        };

        await opensearchNotebooksClient.update(NOTEBOOK_SAVED_OBJECT, noteId, {
          savedNotebook: updatedNotebook,
        });

        return response.ok({
          body: newHypothesis,
        });
      } catch (error) {
        const statusCode =
          error.statusCode || error.output.statusCode || error.output.payload.statusCode;
        return response.custom({
          statusCode: statusCode || 500,
          body: error.message,
        });
      }
    }
  );

  // Update Hypothesis
  router.put(
    {
      path: `${NOTEBOOKS_API_PREFIX}/savedNotebook/{noteId}/hypothesis/{hypothesisId}`,
      validate: {
        params: schema.object({
          noteId: schema.string(),
          hypothesisId: schema.string(),
        }),
        body: schema.object({
          title: schema.maybe(schema.string()),
          description: schema.maybe(schema.string()),
          likelihood: schema.maybe(schema.number({ min: 1, max: 10 })),
          supportingFindingParagraphIds: schema.maybe(schema.arrayOf(schema.string())),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      const opensearchNotebooksClient: SavedObjectsClientContract =
        context.core.savedObjects.client;

      try {
        const { noteId, hypothesisId } = request.params;
        const updates = request.body;

        // Get existing notebook
        const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
        const notebook = notebookObject.attributes.savedNotebook;

        if (!notebook.hypotheses) {
          return response.notFound({
            body: 'Hypothesis not found',
          });
        }

        // Find and update hypothesis
        const hypothesisIndex = notebook.hypotheses.findIndex((h) => h.id === hypothesisId);
        if (hypothesisIndex === -1) {
          return response.notFound({
            body: 'Hypothesis not found',
          });
        }

        const updatedHypothesis = {
          ...notebook.hypotheses[hypothesisIndex],
          ...updates,
          dateModified: new Date().toISOString(),
        };

        notebook.hypotheses[hypothesisIndex] = updatedHypothesis;

        const updatedNotebook = {
          ...notebook,
          dateModified: new Date().toISOString(),
        };

        await opensearchNotebooksClient.update(NOTEBOOK_SAVED_OBJECT, noteId, {
          savedNotebook: updatedNotebook,
        });

        return response.ok({
          body: updatedHypothesis,
        });
      } catch (error) {
        const statusCode =
          error.statusCode || error.output.statusCode || error.output.payload.statusCode;
        return response.custom({
          statusCode: statusCode || 500,
          body: error.message,
        });
      }
    }
  );

  // Add findings to Hypothesis
  router.post(
    {
      path: `${NOTEBOOKS_API_PREFIX}/savedNotebook/{noteId}/hypothesis/{hypothesisId}/findings`,
      validate: {
        params: schema.object({
          noteId: schema.string(),
          hypothesisId: schema.string(),
        }),
        body: schema.object({
          paragraphIds: schema.arrayOf(schema.string()),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      const opensearchNotebooksClient: SavedObjectsClientContract =
        context.core.savedObjects.client;

      try {
        const { noteId, hypothesisId } = request.params;
        const { paragraphIds } = request.body;

        // Get existing notebook
        const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
        const notebook = notebookObject.attributes.savedNotebook;

        if (!notebook.hypotheses) {
          return response.notFound({
            body: 'Hypothesis not found',
          });
        }

        // Find hypothesis
        const hypothesisIndex = notebook.hypotheses.findIndex((h) => h.id === hypothesisId);
        if (hypothesisIndex === -1) {
          return response.notFound({
            body: 'Hypothesis not found',
          });
        }

        // Add new paragraph IDs to existing ones (avoid duplicates)
        const existingIds = new Set(
          notebook.hypotheses[hypothesisIndex].supportingFindingParagraphIds
        );
        paragraphIds.forEach((id) => existingIds.add(id));

        const updatedHypothesis = {
          ...notebook.hypotheses[hypothesisIndex],
          supportingFindingParagraphIds: Array.from(existingIds),
          dateModified: new Date().toISOString(),
        };

        notebook.hypotheses[hypothesisIndex] = updatedHypothesis;

        const updatedNotebook = {
          ...notebook,
          dateModified: new Date().toISOString(),
        };

        await opensearchNotebooksClient.update(NOTEBOOK_SAVED_OBJECT, noteId, {
          savedNotebook: updatedNotebook,
        });

        return response.ok({
          body: updatedHypothesis,
        });
      } catch (error) {
        const statusCode =
          error.statusCode || error.output.statusCode || error.output.payload.statusCode;
        return response.custom({
          statusCode: statusCode || 500,
          body: error.message,
        });
      }
    }
  );

  // Get all hypotheses for a notebook
  router.get(
    {
      path: `${NOTEBOOKS_API_PREFIX}/savedNotebook/{noteId}/hypotheses`,
      validate: {
        params: schema.object({
          noteId: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      const opensearchNotebooksClient: SavedObjectsClientContract =
        context.core.savedObjects.client;

      try {
        const { noteId } = request.params;

        // Get existing notebook
        const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
        const notebook = notebookObject.attributes.savedNotebook;

        return response.ok({
          body: notebook.hypotheses || [],
        });
      } catch (error) {
        const statusCode =
          error.statusCode || error.output.statusCode || error.output.payload.statusCode;
        return response.custom({
          statusCode: statusCode || 500,
          body: error.message,
        });
      }
    }
  );

  // Trigger agent and get hypotheses
  router.post(
    {
      path: `${NOTEBOOKS_API_PREFIX}/savedNotebook/{noteId}/hypotheses/generate`,
      validate: {
        query: schema.object({
          dataSourceId: schema.maybe(schema.string()),
        }),
        body: schema.object({
          agentId: schema.string(),
          question: schema.string(),
          context: schema.string(),
          plannerPromptTemplate: schema.string(),
          plannerWithHistoryTemplate: schema.string(),
          reflectPromptTemplate: schema.string(),
          systemPrompt: schema.string(),
          originalHypothesis: schema.maybe(schema.object({
            supportingFindingParagraphIds: schema.arrayOf(schema.string()),
            newAddedFindingIds: schema.maybe(schema.arrayOf(schema.string()))
          })),
          hypothesisId: schema.maybe(schema.string())
        }),
        params: schema.object({
          noteId: schema.string(),
        }),
      },
    },
    async (
      context,
      request,
      response
    ): Promise<IOpenSearchDashboardsResponse<any | ResponseError>> => {
      const opensearchNotebooksClient: SavedObjectsClientContract =
        context.core.savedObjects.client;
      const { dataSourceId } = request.query;
      const { noteId } = request.params;
      const { agentId, question, context: promptContext, plannerPromptTemplate, plannerWithHistoryTemplate, systemPrompt, reflectPromptTemplate, originalHypothesis, hypothesisId } = request.body;

      const storeInvestigationResponse =
        async ({
          payload,
        }: {
          payload: PERAgentInvestigationResponse;
        }) => {
          const findingId2ParagraphId: { [key: string]: string } = {};
          // Get existing notebook
          const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
          const notebook = notebookObject.attributes.savedNotebook;
          let startParagraphIndex = notebook.paragraphs.length;
          // TODO: Handle legacy paragraphs if operation is REPLACE
          for (let i = 0; i < payload.findings.length; i++) {
            const finding = payload.findings[i];
            let paragraph: ParagraphBackendType<unknown> | null = null;
            const input = {
              inputText: `%md
    Importance: ${finding.importance}
    
    Description:
    ${finding.description}
    
    Evidence:
    ${finding.evidence}
    
                  `.trim(),
              inputType: 'MARKDOWN',
            };
            try {
              paragraph = await createParagraphs({
                noteId,
                paragraphIndex: startParagraphIndex,
                dataSourceMDSId: dataSourceId,
                input,
              }, opensearchNotebooksClient);
              startParagraphIndex++;
            } catch (e) {
              console.error('Failed to create paragraph for finding:', JSON.stringify(finding));
              continue;
            }
            if (paragraph) {
              findingId2ParagraphId[finding.id] = paragraph.id;
              try {
                await updateRunFetchParagraph({
                  noteId,
                  paragraphId: paragraph.id,
                  input,
                  dataSourceMDSId: dataSourceId,
                }, opensearchNotebooksClient, context);
              } catch (e) {
                console.error('Failed to run paragraph:', e);
              }
            }
          }
          const newHypothesis: HypothesisItem = {
            id: payload.hypothesis.id,
            title: payload.hypothesis.title,
            description: payload.hypothesis.description,
            likelihood: payload.hypothesis.likelihood,
            dateCreated: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            supportingFindingParagraphIds: [
              ...(originalHypothesis
                ? [
                  ...originalHypothesis.supportingFindingParagraphIds,
                  ...(originalHypothesis.newAddedFindingIds ?? []),
                ]
                : []),
              ...payload.hypothesis.supporting_findings
                .map((findingId) => findingId2ParagraphId[findingId])
                .filter((id) => !!id),
            ],
          };
          try {
            const newHypotheses = notebook?.hypotheses ?? [];
            const findIndex = notebook.hypotheses?.findIndex(item => item.id === hypothesisId) ?? -1;
            if (
              typeof hypothesisId === 'undefined' ||
              findIndex === -1 ||
              payload.operation === 'CREATE'
            ) {
              newHypotheses.push(newHypothesis);
              // Clear old hypothesis new finding array
              if (typeof hypothesisId === 'undefined' && newHypotheses[findIndex]) {
                newHypotheses[findIndex] = {
                  ...newHypotheses[findIndex],
                  newAddedFindingIds: [],
                };
              }
            } else {
              newHypotheses.push(newHypothesis);
            }
            await updateHypotheses(newHypotheses);
          } catch (e) {
            console.error('Failed to update investigation result', e);
          }
        }

      try {
        // Get existing notebook
        const notebookObject = await opensearchNotebooksClient.get<{ savedNotebook: NotebookBackendType }>(NOTEBOOK_SAVED_OBJECT, noteId);
        const notebook = notebookObject.attributes.savedNotebook;

        /**
         * Update the notebook with
         * 1. Loading state to avoid duplicate agent call
         * 2. Request id to avoid race condition
         */
        const existingContext = notebook.context;

        const noteObject: NotebookBackendType = {
          ...notebook,
          context: {
            ...existingContext,
            variables: {
              ...existingContext?.variables,
              isGeneratingHypotheses: true,
              generatingRequestId: request.id,
            }
          },
          dateModified: new Date().toISOString(),
        };

        const updatedNotebook = await opensearchNotebooksClient.update(
          NOTEBOOK_SAVED_OBJECT,
          noteId,
          {
            savedNotebook: noteObject,
          }
        );

        (async () => {
          const transportClient = await getOpenSearchClientTransport({
            context,
            dataSourceId
          });
          const result = await transportClient.request({
            method: 'POST',
            path: `/_plugins/_ml/agents/${agentId}/_execute`,
            body: {
              parameters: {
                question,
                context: promptContext,
                planner_prompt_template: plannerPromptTemplate,
                planner_with_history_template: plannerWithHistoryTemplate,
                reflect_prompt_template: reflectPromptTemplate,
                system_prompt: systemPrompt
              }
            }
          });

        })();

        return response.ok({
          body: updatedNotebook
        });
      } catch (error) {
        const statusCode =
          error.statusCode || error.output.statusCode || error.output.payload.statusCode;
        return response.custom({
          statusCode: statusCode || 500,
          body: error.message,
        });
      }
    }
  );
}
