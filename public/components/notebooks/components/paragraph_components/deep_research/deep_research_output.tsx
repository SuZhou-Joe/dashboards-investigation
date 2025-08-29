/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useMemo } from 'react';
import MarkdownRender from '@nteract/markdown';
import {
  EuiLoadingContent,
  EuiText,
  EuiSpacer,
  EuiFlexItem,
  EuiFlexGroup,
  EuiPanel,
  EuiTitle,
  EuiIcon,
  EuiSmallButtonEmpty,
  EuiLoadingSpinner,
} from '@elastic/eui';
import { useObservable } from 'react-use';
import moment from 'moment';

import {
  extractCompletedResponse,
  extractFailedErrorMessage,
  isStateCompletedOrFailed,
} from '../../../../../../common/utils/task';
import { formatTimeGap } from '../../../../../utils/time';

import { isMarkdownText } from './utils';
import { PERAgentTaskService } from './services/per_agent_task_service';
import { PERAgentMemoryService } from './services/per_agent_memory_service';
import { MessageWrapper } from '../../message';

interface Props {
  taskService: PERAgentTaskService;
  executorMemoryService: PERAgentMemoryService;
  showSteps?: boolean;
  onViewDetails: (messageId: string) => void;
  onExplainThisStep: (messageId: string) => void;
}

export const DeepResearchOutput = ({
  taskService,
  executorMemoryService,
  showSteps,
  onViewDetails,
  onExplainThisStep,
}: Props) => {
  const observables = useMemo(
    () => ({
      message$: executorMemoryService.getMessages$(),
      messagePollingState$: executorMemoryService.getPollingState$(),
      task$: taskService.getTask$(),
      executorMemoryId$: taskService.getTask$(),
    }),
    [executorMemoryService, taskService]
  );
  const task = useObservable(observables.task$);
  const executorMessages = useObservable(observables.message$);
  const executorMessageId = useObservable(observables.executorMemoryId$);
  const loadingExecutorMessage = useObservable(observables.messagePollingState$);

  const finalMessage = useMemo(() => {
    if (!task) {
      return '';
    }
    if (task.state === 'COMPLETED') {
      return (
        extractCompletedResponse(task) ?? 'Task was completed, but failed to load inference result.'
      );
    }

    if (task.state === 'FAILED') {
      return `Failed to execute task, reason: ${extractFailedErrorMessage(task)}`.trim();
    }
    return '';
  }, [task]);

  const renderTraces = () => {
    if (!showSteps) {
      return null;
    }
    return (
      <>
        <EuiTitle size="m">
          <h4>Steps performed</h4>
        </EuiTitle>
        <EuiSpacer size="s" />
        {!!executorMessages &&
          executorMessages.map((message, index) => {
            const isLastMessageLoading =
              index === executorMessages.length - 1 &&
              !message.response &&
              !isStateCompletedOrFailed(task.state);
            return (
              <>
                <EuiPanel key={message.message_id} paddingSize="s" borderRadius="l" hasBorder>
                  <EuiFlexGroup alignItems="center">
                    <EuiFlexItem grow={false}>
                      {isLastMessageLoading ? (
                        <EuiLoadingSpinner />
                      ) : (
                        <EuiIcon type="checkInCircleEmpty" color="success" />
                      )}
                    </EuiFlexItem>
                    <EuiFlexItem grow>
                      <EuiText size="s">{message.input}</EuiText>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiSmallButtonEmpty
                        iconSide="right"
                        onClick={() => {
                          onViewDetails(message.message_id);
                        }}
                      >
                        View details
                      </EuiSmallButtonEmpty>
                      <EuiSmallButtonEmpty
                        iconSide="right"
                        onClick={() => {
                          onExplainThisStep(message.message_id);
                        }}
                      >
                        Explain this step
                      </EuiSmallButtonEmpty>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </EuiPanel>
                <EuiSpacer size="s" />
              </>
            );
          })}
      </>
    );
  };

  useEffect(() => {
    if (!showSteps) {
      return;
    }
    const stopPolling = executorMemoryService.startPolling();
    return () => {
      stopPolling?.();
    };
  }, [executorMemoryService, showSteps]);

  return (
    <>
      {renderTraces()}
      {(loadingExecutorMessage ||
        !executorMessageId ||
        !task ||
        !isStateCompletedOrFailed(task.state)) && <EuiLoadingContent />}
      {finalMessage && (
        <MessageWrapper type="output">
          <EuiText className="markdown-output-text" size="s">
            {isMarkdownText(finalMessage) ? <MarkdownRender source={finalMessage} /> : finalMessage}
          </EuiText>
          {task && task.last_update_time && task.create_time && (
            <EuiText size="xs" color="subdued" style={{ marginTop: '8px' }}>
              Total Duration:{' '}
              {formatTimeGap(Number(task.last_update_time) - Number(task.create_time))}
              &nbsp;&nbsp; Last updated: {moment(task.last_update_time).format()}
            </EuiText>
          )}
        </MessageWrapper>
      )}
      <EuiSpacer />
    </>
  );
};
