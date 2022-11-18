// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {retryOnFailAxios} from '@subql/node-core/utils/fetchHelpers';
jest.setTimeout(30000);

describe('fetchHelpers', () => {
  it('retryOnFail', async () => {
    const axiosError = new Error();
    (axiosError as any).response = {status: 429};

    const mockAxiosRequest = jest.fn().mockImplementation(() => {
      throw axiosError;
    });

    const mockNotAxiosRequest = jest.fn().mockImplementation(() => {
      throw new Error('Oh no it failed');
    });
    // If not Axios error, should only be called once
    await expect(retryOnFailAxios(mockNotAxiosRequest, [429])).rejects.toThrow();
    expect(mockNotAxiosRequest).toBeCalledTimes(1);

    //If Axios error, should retry 5 times before throwing
    await expect(retryOnFailAxios(mockAxiosRequest, [429])).rejects.toThrow();
    expect(mockAxiosRequest).toBeCalledTimes(5);
  });
});