/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EuiAvatar, EuiFlexGroup, EuiFlexItem, EuiPanel } from '@elastic/eui';
import React from 'react';
import { useContext } from 'react';
import { useObservable } from 'react-use';
import { NotebookReactContext } from '../../context_provider/context_provider';

export const MessageWrapper = (props: { type: 'input' | 'output'; children: React.ReactNode }) => {
  const { type, children } = props;
  const { state } = useContext(NotebookReactContext);
  const { owner } = useObservable(state.getValue$(), state.value);

  if (type === 'input') {
    return (
      <EuiFlexGroup gutterSize="s" alignItems="flexStart">
        <EuiFlexItem grow={false}>
          <EuiAvatar name={owner ?? 'User'} size="l" />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiPanel paddingSize="m" hasShadow={false} color="subdued">
            {children}
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem grow={false} />
      </EuiFlexGroup>
    );
  }

  return (
    <EuiFlexGroup gutterSize="s" alignItems="flexStart" style={{ overflow: 'hidden' }}>
      <EuiFlexItem grow={false} />
      <EuiFlexItem style={{ overflow: 'hidden' }}>
        <EuiPanel paddingSize="m" hasShadow={false} color="primary">
          {children}
        </EuiPanel>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiAvatar name="Agent" size="l" />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
