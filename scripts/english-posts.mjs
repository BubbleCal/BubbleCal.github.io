const md = (value) => value.trim();

export const englishPosts = {
  "4bitpqreadingimplementing": {
    title: "4-bit PQ: Reading and Implementation Notes",
    summary:
      "Notes from implementing 4-bit product quantization: why it should be faster than 8-bit PQ, where the paper leaves implementation gaps, and what tradeoffs worked in practice.",
    content: md(`
I have recently been working on [4-bit PQ, from Accelerated Nearest Neighbor Search with Quick ADC](https://arxiv.org/abs/1704.07355). Intuitively, 4-bit PQ should be much faster than 8-bit PQ, but after implementing it end to end I found quite a few traps.

## Product Quantization

Start with ordinary PQ. Product quantization splits a D-dimensional vector into M equal-sized sub-vectors. For each sub-vector position, it runs k-means over all vectors and produces 2^B centroids. Each original vector is then represented by the id of the nearest centroid for every sub-vector.

Here B is the number of bits. It is usually 8, for a simple reason: one sub-vector code can be stored in a u8, which gives a good compression ratio. When people talk about PQ, they usually mean B = 8, which compresses D f32 values into M u8 values.

At query time, to compute the distance from a query vector q to all vectors in the dataset, we first build a distance table. Since every quantized sub-vector is represented by a centroid id, the table precomputes the distance from q to every centroid:

~~~
distance_table[i][j] = distance from q to the j-th centroid of the i-th block
~~~

For a compressed vector code, the distance is:

~~~
sum over j in [0, M): distance_table[j][code[j]]
~~~

## Transposing

I first saw this idea in [Accelerated Nearest Neighbor Search with Quick ADC](https://arxiv.org/abs/1704.07355), but the same optimization also applies to 8-bit PQ and works very well.

Consider the straightforward way to compute distances for compressed vectors:

~~~rust
let mut dists = vec![0.0f32; n]
for i in 0..n {
    for j in 0..M {
        dists[i] += distance_table[j][code[i][j]]
    }
}
~~~

The problem is that accesses to the distance table are effectively random, so the computation becomes memory-bound. If we switch the loop order, things get much better:

~~~rust
let mut dists = vec![0.0f32; n]
for j in 0..M {
    for i in 0..n {
        dists[i] += distance_table[j][code[i][j]]
    }
}
~~~

The second dimension of the distance table is 2^8 = 256 f32 values, or 1 KiB, so locality is still good. The problem is that access to code becomes random. That is easy to fix by transposing the code matrix:

~~~rust
let mut dists = vec![0.0f32; n]
for j in 0..M {
    for i in 0..n {
        dists[i] += distance_table[j][code[j][i]]
    }
}
~~~

This improves locality and also gives the compiler a much better chance to generate efficient code. The performance gain is significant.

## 4-bit PQ

Back to 4-bit PQ. Based on the optimization above, we can go one step further. Registers are faster than cache. Ignoring register size for a moment, the computation is equivalent to this pseudo-code:

~~~rust
let mut dists = vec![0.0f32; n]
for j in 0..M {
    let num_centroids = 2.pow(B);
    for i in (0..n).step_by(num_centroids) {
        let shuffled = shuffle(distance_table[j], code[j][i..i+num_centroids]);
        dists[i..i+num_centroids] += shuffled;
    }
}
~~~

In other words, the core computation can be implemented with shuffle plus add. For 8-bit PQ, distance_table[i] has 256 f32 values, or 1 KiB. Current registers are at most 512 bits on x86 and 128 bits on ARM. To make the table fit, the paper uses two tricks:

- Use 4 bits instead of 8 bits, so there are only 2^4 = 16 centroids. Sixteen f32 values are still 512 bits, so this is not enough by itself.
- Quantize the distances to u8 by scalar quantization. Sixteen u8 values fit exactly in 128 bits.

## Implementation

The idea is straightforward up to this point, but distance quantization confused me a lot in the actual implementation. In the paper, dists[i..i+num_centroids] is also a u8x16, which means the whole accumulation process must avoid u8 overflow. How is that possible?

The simplest solution is to set the scalar quantization max value to the sum of the whole distance table. Unsurprisingly, this destroys recall.

I went back to the paper to see what the authors did, and the answer is a good reminder of the gap between papers and production implementations. They first run a brute-force search, for example top-200, then use the farthest distance as the max value. During accumulation they use saturating add. If the query is top-100, the results that can actually make it into the final answer should not overflow. This is too impractical for my use case, so I did not use it.

In the end, I gave up on keeping the result in u8x16 all the way through and wrote intermediate results back to memory. Because 4-bit PQ packs two blocks into one byte, I needed to store the sum of two blocks in u8x16. That means I only need the maximum sum of neighboring blocks in the distance table as the max value for scalar quantization. This halves the number of memory writes, so performance is still good, and more importantly, recall loss is small.
`)
  },

  "paperreadingvbaseunifyingonlinevectorsimilaritysearchandrelationalqueriesviarelaxedmonotonicity": {
    title: "Paper Reading: VBASE, Relational Queries via Relaxed Monotonicity",
    summary:
      "A reading note on VBASE and relaxed monotonicity: how ANN search can expose a streaming primitive and why that matters for filters, hybrid scoring, and vector joins.",
    content: md(`
# TL;DR

This paper introduces the concept of relaxed monotonicity. It observes that ANN search over vector indexes usually has two phases. In the first phase, the search quickly moves closer to the query vector. In the second phase, candidates as a whole gradually move farther away from the query. The paper gives a way to detect when the search has entered the second phase. Once the search has entered that phase and already has k results, it can stop early and improve performance.

The powerful part is not just early termination. Once we know the search has entered the second phase, we can continue the search and produce more vectors in roughly increasing distance order. This breaks out of the traditional top-k-only ANN interface and gives us a streaming result primitive.

With that streaming primitive, scalar filtering, hybrid scoring, multi-vector queries, and even vector joins can be optimized significantly.

# Relaxed Monotonicity

From the perspective of monotonicity, an index search starts from some point and keeps looking for data points that are closer to the target. Vector indexes do not have strict monotonicity, but the HNSW example in the paper illustrates the pattern:

![image-1702210347863](/upload/2023/12/image-1702210347863.png)

The search process can be divided into two phases. Early in the query, traversal in the upper layers quickly moves the candidate set closer to the target. Later, the candidate set has mostly converged, and continuing traversal rarely finds significantly better results.

If we can detect this turning point, we can optimize ANN search: after entering the second phase, once we have K results we can stop. The paper gives this intuition:

![image-1702210525568](/upload/2023/12/image-1702210525568.png)

Here q is the query vector, R_q is the neighborhood radius, and M_q^s is the median distance from the current traversal window to q. The intuition is that if M_q^s >= R_q, the search may have entered the second phase.

This is not a rigorous guarantee. For example, if the query is top-2 and w = 1, the method above may decide that the search has entered the second phase even when recall is 0. In an HNSW-style implementation, the coarse-grained graph does not use this check and is always searched. The check is used only in the fine-grained graph. A larger w can also improve recall.

Relaxed monotonicity provides a very useful primitive. The algorithm only needs to run until it reaches the second phase. It can then save the traversal state and keep producing results, effectively exposing a streaming query primitive.

# Scenario Optimizations

The streaming primitive enabled by relaxed monotonicity can improve several workloads.

## Scalar Filter plus Vector Search

Scalar filtering with vector search is a basic feature in vector databases. Because ANN indexes usually expose only a batched top-k interface, current systems mainly use two strategies:

- Pre-filtering: run scalar filtering first, generate a bitmap, and then use the bitmap to filter vectors during ANN search.
- Post-filtering: query for K' results where K' is larger than K, then apply the scalar filter to the returned result set.

Counterintuitively, pre-filtering can slow down ANN indexes because the search may need to traverse more vectors to find enough matching results. Lower selectivity usually means worse performance. Post-filtering has the obvious problem that K' is hard to choose. We do not know in advance how many candidates will be filtered out. If the final result set is too small, the system may have to retry with an even larger K'', which can be very expensive.

![image-1702212206389](/upload/2023/12/image-1702212206389.png)

With the streaming primitive, scalar filtering plus vector search becomes simple. We continuously pull results from the index and apply the scalar filter. Once the final result set reaches K, we stop. Performance is equivalent to post-filtering with the optimal K~.

## Multi-vector Queries

A multi-vector query searches over multiple vector columns and aggregates the scores to select the final top-k results.

I stopped here for now. I need to learn NRA first before continuing.
`)
  },

  "PaperReadingFilterRepresentationinVectorizedQueryExecution": {
    title: "Paper Reading: Filter Representation in Vectorized Query Execution",
    summary:
      "A reading note on bitmap and selection-vector filter representations in vectorized query engines, including when each strategy wins and why a hybrid plan can help.",
    content: md(`
Vectorized execution engines commonly represent filters with a few strategies:

1. Use a bitset to mark selected rows.
2. Use a vector to store the indexes of selected rows.
3. Copy selected rows and pass the copied data to the next operator.

This paper mainly discusses the first two strategies, called Bitmap (BM) and Selection Vector (SV). Some systems also use the third strategy. The paper does not discuss it, but I have seen DataFusion use it, so I will return to it at the end.

## Filter Representation

For BM and SV, there are three main strategies:

- BMFull: always process all rows. Values for unselected rows are undefined. The advantage is that it can fully exploit vectorization.
- BMPartial: process only selected rows, but it still needs to scan all positions and cannot fully use vectorization.
- SVPartial: scan only selected indexes, but it cannot fully use vectorization either.

The Manual suffix in the paper means SIMD is implemented manually, using AVX-512, instead of relying on compiler optimization. SVManual can still use vectorization to some extent.

## Cost Model

The paper estimates computation cost with this formula:

~~~
R = N * (I + O)
~~~

N is the number of rows, I is the per-iteration cost, O is the per-row processing cost, and R is the estimated runtime.

The cost of each strategy is determined by these three variables. I is fixed for a given strategy. O and N depend on filter selectivity, and O is also strongly affected by the data type being processed.

BMFull is special because all three variables are fixed. From this model, we can compare strategies under different filter rates.

## Comparison Scenarios

The paper defines two primitives:

- Update: operations that update the selected set, such as where a < b.
- Map: operations that transform data, such as select a + b.

The experiments mainly compare these two kinds of primitives.

### No Data Parallelism

For string processing, integer division, and similar workloads, the CPU cannot efficiently vectorize multiple rows. In these cases, the per-row processing cost is higher.

![image](/upload/2023/12/image.png)

BMPartial and SVPartial perform very similarly. BMPartial has higher iteration overhead, so SVPartial is usually better. In this scenario, SVPartial is the best strategy.

### Inefficient Data Parallelism

For logical AND and OR operations, SISD may execute less code because of short-circuiting. SIMD does not necessarily cost less than SISD here.

![image-1701504940143](/upload/2023/12/image-1701504940143.png)

SVPartial is still best overall. BMFull only has an advantage at high selectivity, mainly for the Map primitive.

### Data Parallelism

For ordinary numeric operations, SIMD can be used effectively.

![image-1701505563620](/upload/2023/12/image-1701505563620.png)

In this case, partial strategies only win at low selectivity, below roughly 0.2. At higher selectivity, BMFull wins because it benefits from vectorization.

The paper also studies how the number of arithmetic instructions affects the threshold:

![image-1701505711380](/upload/2023/12/image-1701505711380.png)

The threshold is quite stable, around 0.2.

## TPC-H Tests

The paper proposes a hybrid strategy: use BMFull, or BMFullManual, when selectivity is above 0.2, and use SVManual when selectivity is low. It then compares this hybrid strategy with the single strategies.

Here is one result:

![image-1701506019343](/upload/2023/12/image-1701506019343.png)

### Q1: High-selectivity Data Parallelism

This query has a high-selectivity filter, around 0.95, followed by an aggregation with side effects, which means it cannot be data-parallel.

During filtering, BMFull is 1.6x faster than SVPartial and 1.3x faster than SVManual. But the query time is dominated by the final aggregation, so the end-to-end runtime is similar. One detail is worth noting: BMPartial and BMFull are equivalent for the final aggregation, but BMFull spends more time overall because AVX-512 during filtering causes CPU downclocking.

### Q6: Mixed-selectivity Data Parallelism

In this test, the second filter reduces selectivity to 0.15. This triggers the hybrid strategy to switch representations, making it a good case for comparing hybrid performance.

The hybrid strategy is faster than every single strategy. However, BMFull plus SVManual is slower than BMFull plus BMPartial, even though SVManual alone is better than BMPartial. The reason is conversion overhead from bitmap to selection vector.

Because final selectivity is low, most query time is spent in earlier SLDP operations, so AVX-512 downclocking does not hurt the whole query much.

### Q4: Low-selectivity and Weak Data Parallelism

This test also has low selectivity and cannot fully exploit SIMD. BMFull plus SVPartial is the best strategy, but it is not much better than BMFull plus BMPartial.

## Conclusion

From the paper's results, a hybrid strategy can improve performance by around 30%. When designing the strategy, one should account for the query type and for effects such as AVX-512 downclocking. Personally, I would choose BMFull plus BMPartial. It is the simplest to implement and is optimal in many cases.

Finally, about the copy-selected-data strategy mentioned at the beginning: using the same analysis, this strategy should beat SVPartial when selectivity is low and the operation is data-parallel. It adds copy overhead, but it lets the engine use vectorization more fully. DataFusion is not slow with this approach. For high-selectivity filters, though, it should perform poorly, and it should also be bad for string processing.

The most uncomfortable part is that this representation cannot easily convert to or from bitmap and selection-vector formats, unless the data carries an extra index column, which adds its own overhead. That leaves little flexibility or room for future optimization.
`)
  },

  "shou-wang-xian-feng-ru-men--duan-zan-hei-ping-xian-xiang-bei-hou-de-xian-shi-qi-yuan-li": {
    title: "Overwatch Basics: The Monitor Theory Behind Brief Black Screens",
    summary:
      "A debugging note on why a 2K 240 Hz monitor briefly blacked out when switching away from fullscreen games, and how refresh rate, bit depth, DisplayPort bandwidth, and DSC explain it.",
    content: md(`
I bought a new monitor recently: 2K at 240 Hz. It felt much smoother than 144 Hz, but I quickly ran into a problem.

When I played a game in fullscreen mode and switched back to the desktop, the monitor would go black for a short time and show an OSD status popup. I often need to switch out of games, so the experience was bad enough that I had to play in borderless windowed mode.

## Clue 1: Refresh Rate

My memory had some issues before, and the game could not stay stable at 240 fps. I decided to lower the refresh rate to 200 Hz. Then I noticed that when I used 200 Hz, the black-screen problem disappeared.

At that point, I suspected the refresh rate might be so high that the bandwidth from the GPU to the monitor exceeded the DisplayPort limit. But logically, if it exceeded the limit, it should simply not work. I did not know enough about monitors then, so I did not dig further.

## Clue 2: Bit Depth

A few days later, while changing GPU driver settings, I noticed that the output color depth was 10-bit. Then I remembered that this monitor supports 10-bit output. This brought back the bandwidth suspicion, so I changed the output to 8-bit. For this kind of esports monitor, color accuracy is not the point anyway, and I do not need 10-bit just to play games.

Things then developed exactly as expected. After switching to 8-bit, the black-screen problem disappeared even at 240 Hz. To verify the guess, I calculated the bandwidth requirements.

At 8-bit, the GPU output bandwidth is:

~~~
2560 * 1440 * 240 * 8 * 3 = 21.23 Gbps
~~~

DisplayPort 1.4 has a maximum bandwidth of 32.4 Gbps, so this is below the limit. At 10-bit:

~~~
2560 * 1440 * 240 * 10 * 3 = 26.54 Gbps
~~~

This is still below 32.4 Gbps, so it did not explain the issue. I then decided to learn more about DisplayPort.

After reading through Wikipedia, the first important detail was that DisplayPort uses 8b/10b encoding for transmission. Every 8 bits of data are encoded as 10 bits, adding 2 bits of overhead. That means the effective bandwidth is:

~~~
32.4 Gbps * 80% = 25.92 Gbps
~~~

Now the hypothesis made partial sense: 10-bit output really does exceed the effective DP bandwidth. While learning about DP, I also learned about DSC, or Display Stream Compression. In short, DSC compresses display data. I checked the monitor settings, and DSC was enabled.

That means when I used 10-bit output, the GPU output bit depth inside and outside the game differed, causing the monitor to switch DSC on and off. That switch causes a short black screen.

## One More Thing

The calculation above is still wrong. The English Wikipedia page for DisplayPort lists bandwidth requirements for many resolutions and refresh rates, but the numbers did not match mine. The page notes that the calculation includes CVT-RB v2, so I learned about that as well.

In simple terms, a monitor does not update all pixels at once. It scans line by line. To avoid interference, the actual scan width and height are larger than the visible resolution. The actual timing values are defined by VESA standards and differ by resolution and refresh rate.

VESA provides a [calculator](https://tomverbeure.github.io/video_timings_calculator). For my 2K at 240 Hz case, the actual scan width is 2640 and the actual scan height is 1619. Therefore, the 8-bit bandwidth is actually:

~~~
2640 * 1619 * 240 * 8 * 3 = 24.62 Gbps
~~~

This matches the value on Wikipedia and is already very close to the effective bandwidth limit of DP 1.4.

## Smoother Overwatch

Switching to 8-bit and disabling DSC makes the game noticeably smoother. DSC itself adds latency. Many sources say the impact is almost impossible to notice, but many Reddit users say the difference is obvious. For competitive players, DSC should be disabled.
`)
  },

  "swap-cache-mmap": {
    title: "Swap, Cache, and mmap",
    summary:
      "Notes on swap, page cache, mmap, why databases moved away from mmap as a buffer-pool replacement, and why read-only mmap can still be acceptable for immutable Milvus data.",
    content: md(`
# Swap, Cache, and mmap

As is well known, Milvus needs to load all data into memory before executing queries. This creates high memory requirements for query nodes. In offline scenarios, users may not be sensitive to query performance and can accept degradation. The conventional solution is to build a buffer pool and load data into memory on demand during queries.

However, that would require a large refactor and is not suitable for the current stage of Milvus, so I will not expand on it here. A simpler and more direct option is mmap. While working on this change recently, I ran into several issues and learned a lot, so I am recording the notes here.

## Cache Mechanisms

### Swap Space

An operating system has swap space. When memory is insufficient, it swaps some pages out to disk, into the swap space. The size of swap space is configurable and is usually chosen based on machine RAM. There are many recommended values online.

If memory is not enough, why not simply increase swap space and let the OS decide which pages to evict? The application cannot control which pages are swapped out. If pages on the critical path are swapped out, performance can suffer badly.

### Page Cache

When the OS accesses a file, it often reads neighboring pages into the page cache as well, usually the current page, the previous 15 pages, and the next 16 pages. The page cache has a swap-in and swap-out mechanism similar to swap. The difference is that the OS knows which file a page comes from, so it can evict the page back to that file. If it is dirty, a disk write is needed. Otherwise, the page can simply be removed from physical memory.

In short, swap space is a special kind of page cache for anonymous pages, meaning pages not associated with files. Anonymous pages are swapped out to swap space, while file-backed pages are evicted to their associated files.

### mmap

mmap can be divided into two types: file-backed maps and anonymous maps. A file-backed map usually looks like this:

~~~cpp
void* map = mmap(NULL, size, PROT_READ, MAP_SHARED, fd, offset)
~~~

An anonymous map usually looks like this:

~~~cpp
void* map = mmap(NULL, size, PROT_READ, MAP_SHARED | MAP_ANONYMOUS, -1, 0)
~~~

Memory allocated by an anonymous map consists of the anonymous pages described above. When memory is insufficient, those pages are swapped out to swap space.

However, this still differs from malloc. malloc allocates memory on the heap, while an anonymous map only establishes a mapping and does not allocate physical memory immediately. In practice, malloc may call mmap to create anonymous maps for large allocations.

## mmap in Database Systems

### File IO

Consider reading a file. The simplest approach is open followed by read. In this process, there is an extra copy from data read from disk into a user-space buffer:

~~~
file -> page cache -> user buffer
~~~

The write path is similar:

~~~
user buffer -> kernel buffer -> file
~~~

With file-backed mmap, access goes directly to the page cache. Eviction on writes also goes directly from page cache to file, so one copy can be avoided. Based on this, some databases use mmap as an optimization.

### Buffer Pool

Databases usually manage pages in one of two ways. One option is to implement their own buffer pool. The other is to mmap data files directly, effectively reusing the operating system's cache mechanism.

### Why We No Longer Need mmap

Using mmap as a replacement for a buffer pool is now generally considered a bad idea. See [this paper](https://db.cs.cmu.edu/papers/2022/cidr2022-p13-crotty.pdf). According to the same paper, using mmap to accelerate file IO is also a poor fit today.

For file IO, modern operating systems provide many asynchronous IO mechanisms, such as io_uring. mmap blocks synchronously on page faults, so it can perform much worse than async IO. When reading files, the application can also provide hints to bypass the page cache and get improvements similar to mmap.

For buffer pools, mmap's page cache is fully controlled by the operating system. Although madvise can adjust OS behavior for the mapping, it is easy to use incorrectly. mmap can cause a database to flush pages at the wrong time, which may break consistency in transaction processing.

### Why mmap Still Works for Milvus

The ideal solution is still to implement a buffer pool. A buffer pool designed around the system's own access patterns can achieve better performance. But mmap is not too problematic for Milvus in its current situation, because Milvus data is immutable. We only need read-only mappings.
`)
  },

  "824-lab2": {
    title: "MIT 6.824 2022 Lab 2: Raft",
    summary:
      "Notes from redoing MIT 6.824 Lab 2, covering Raft elections, log replication, persistence, log compaction, and common edge cases in the lab tests.",
    content: md(`
# MIT 6.824 Lab 2: Raft

I recently wanted to redo 6.824 and see whether it would feel easier now. The last time I did it was in my sophomore year, and I remember almost nothing about the old code. It was probably not very good anyway. Lab 1, MapReduce, is not too difficult, so I skipped it this time and started directly from Lab 2.

Following the course requirements, I will not share implementation code here. If you run into problems, feel free to contact me and discuss.

One small complaint: the course suggests not using time.Ticker, but I think time.Sleep is easier to get wrong. If you have written Go before, I suggest ignoring some of the language-specific advice from the course.

## Lab 2A: Elections

The goal of 2A is to implement Raft elections:

- Implement RequestVote.
- Add AppendEntries, but not the full behavior from the paper yet.
- Implement role transitions among Follower, Candidate, and Leader.
- Implement the election logic.

### Triggering an Election

An election is triggered when a node is a follower and does not receive a valid RPC request within ElectionTimeout. After triggering an election, it becomes a candidate and repeatedly runs elections. Each election should be separated by ElectionTimeout.

ElectionTimeout is not a fixed value. In the paper, it is 150 ms to 300 ms. In this lab, it needs to be larger. A reasonable range is around 650 ms to 900 ms.

### Election Flow

When a node starts an election:

1. It becomes a candidate, increments the term, and votes for itself.
2. It sends RequestVote to all other nodes.
3. If it gets a majority of votes, it becomes leader.

If it discovers that another node has a larger term during the election, it gives up and becomes a follower.

Without optimization, elections can take too long when some nodes have network failures. Nodes may vote for one another in turns and no one wins. Implementation details that matter:

- Requests must be sent concurrently.
- There is no need to wait for all RPCs to return.
- If a majority is already reached, the election can finish immediately.
- If it is already impossible to get a majority, it can also stop early.

### Heartbeats

Once a leader exists, it must send heartbeats so followers do not start new elections. The heartbeat interval should be much smaller than ElectionTimeout. The lab tests limit heartbeat frequency to at most 10 times per second, so 100 ms is a natural interval.

Leader heartbeat sending should be optimized in the same way as elections. It should not wait synchronously for all RPCs to return. If one node is offline, a heartbeat round would otherwise take too long and followers may start elections.

## Lab 2B: Log Replication

Lab 2B implements log replication and handles log consistency when nodes go offline, come back, or the cluster changes leader. This stage requires a complete AppendEntries implementation and leader-side log replication logic. It is harder than 2A, although the amount of code is not large. The key is to understand several Raft concepts.

### Commit and Apply

The log replication process is roughly:

- When the leader receives a write request, it first appends the log entry to its own logs.
- The leader tracks the largest replicated index on each node as matchIndex.
- The leader also tracks the next log index to send to each node as nextIndex.
- On every heartbeat, the leader sends logs starting at nextIndex[id] to each follower.
- When a majority of nodes have received a log entry, that entry can be committed, and the leader updates commitIndex.
- Once a log is committed, it can be applied.

Important details:

- It may look like nextIndex is always matchIndex + 1, and in most cases it is. But when a leader is just elected, this condition may not hold. matchIndex is the maximum log index known to be replicated successfully, while nextIndex is the guessed first missing log index on that follower.
- nextIndex is a guess. If the guess is wrong, the follower rejects the AppendEntries request. The leader then needs to adjust nextIndex. Simply doing nextIndex -= 1 may not pass the tests. A simple algorithm that decreases it faster helps find the matching point sooner.
- Commit and apply are independent execution flows. commitIndex is the maximum log index that can be applied. Each node can use a goroutine to compare lastApplied and commitIndex and decide whether to apply logs.

#### Edge Case

Consider a case where S1 is leader in term 1, writes X, later writes Y, then observes that S3 has a larger term and becomes follower. Because S1 has longer logs, it may become leader again and replicate Y to followers. Since Y was not written in S1's current term, S1 cannot commit Y directly.

To handle this case, when a node becomes leader, it should write an empty log entry so earlier logs can be committed correctly. In this lab, tests check command types and indexes, so writing an empty command directly is not convenient. You can ignore this case for the lab or use a more complicated test-specific workaround.

In the lab, apply means sending the command into applyCh. Tests read commands from applyCh to determine whether logs were replicated correctly.

### Follower Log Replication

When a follower receives AppendEntries:

- It checks whether prevLogIndex and prevLogTerm match its own log.
- It writes the request's logs into its own logs.
- It updates commitIndex and applies logs.

When writing logs, the follower starts from prevLogIndex + 1. This differs slightly from the paper because in the lab we can ignore log-write cost and simplify by writing directly from prevLogIndex + 1. A mature implementation would check whether existing logs from that position match the request and only overwrite from the first mismatch.

commitIndex is updated from leaderCommit in the request. This value may be smaller than the starting index of the logs in this request. In other words, a log entry may require at least two AppendEntries RPCs before it is committed: one to replicate the log, and another to update commitIndex.

When leaders change or nodes go offline and come back, a far-behind node may receive a request whose leaderCommit is no smaller than the replicated log index, because commit requires only that a majority has replicated the log.

### Log Matching Property

The log matching property says: if two logs on different nodes have the same index and term, then they are the same log entry, and all previous log entries are also the same.

This property is the correctness guarantee behind the replication mechanism. The key is that followers check prevLogIndex and prevLogTerm. A proof by contradiction:

1. Assume nodes A and B have one log entry with the same index and term but different content. Let that be the first such log.
2. The same term means this log was replicated by the same leader.
3. When the leader replicated to A and B, prevLogIndex and prevLogTerm both matched. Therefore the leader knew that the next log to copy was its own logs[prevLogIndex + 1].
4. That contradicts the assumption that A and B have different entries at that index.

## Lab 2C: Persistence

The Lab 2C tests are much stronger. Persistence itself does not require much code and has no particularly tricky part. More often, 2C exposes incomplete details from 2A and 2B. Common mistakes:

- A follower should not suppress elections after receiving just any request within ElectionTimeout. It should remain follower only after receiving a valid request.
- votedFor means the node voted for someone in the current term. When the term changes, this value must be reset.
- One voting condition is that the follower's log must not be newer than the candidate's log. Compare the term of the last log first. A larger term is newer. If terms are equal, the longer log is newer.
- A leader can only commit logs from its own term.

You can repeat a test several times with:

~~~shell
go test -failfast -race -timeout=15m -count 5 -run [TestCase] > test.log
~~~

The command stops after the requested count or fails early when a test fails.

## Lab 2D: Log Compaction

Lab 2D implements log compaction. Raft uses snapshots for log compaction.

### Trim Log

When creating a snapshot at index i, all logs before i should be discarded. The Raft paper says log indexes start from 1. Initialization can keep an empty log in the slice. For snapshots, one option is to put log i at the front of the log slice so the metadata of log_i is preserved.

All indexes in Raft, such as commitIndex, lastApplied, and nextIndex, are logical indexes, not direct slice indexes. After snapshotting, we need to record the snapshot log index. Later, when accessing a logical index, convert it to a physical slice index:

~~~golang
idx = index - snapshotIndex
~~~

Each time a snapshot is created, snapshotIndex is updated to the snapshot index.

The applyCh provided by the lab is an unbuffered channel. If the apply goroutine keeps holding the lock while applying a batch of data, triggering Snapshot can deadlock with the Snapshot method. Therefore, the apply process should use select to attempt applying. If it fails, it should release the lock and retry later.

This change affects the Lab 2B tests. When multiple servers are applying, apply failures become very likely and apply efficiency can become too low. Therefore, use context or a timer so apply fails only after a timeout. Do not use a default case directly.
`)
  }
};
